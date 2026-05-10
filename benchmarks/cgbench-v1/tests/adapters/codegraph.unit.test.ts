import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodeGraphAdapter } from '../../src/adapters/codegraph.js';

describe('CodeGraphAdapter — FalkorDB-Docker-only constraint', () => {
  let dataDir: string;
  const originalDriver = process.env['CODEGRAPH_DRIVER'];

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cg-unit-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    if (originalDriver === undefined) {
      delete process.env['CODEGRAPH_DRIVER'];
    } else {
      process.env['CODEGRAPH_DRIVER'] = originalDriver;
    }
  });

  it('throws when CODEGRAPH_DRIVER=falkordblite', async () => {
    process.env['CODEGRAPH_DRIVER'] = 'falkordblite';
    const adapter = new CodeGraphAdapter({ dataDir });
    await expect(
      adapter.attach({ codeRoots: [{ language: 'typescript', path: dataDir, commitSha: 'test' }] }),
    ).rejects.toThrow(/falkordblite is not supported/i);
  });
});

describe('CodeGraphAdapter — env purity', () => {
  let dataDir: string;
  const savedDim = process.env['CODEGRAPH_EMBEDDING_DIM'];
  const savedProvider = process.env['CODEGRAPH_EMBEDDING_PROVIDER'];

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cg-env-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    if (savedDim === undefined) delete process.env['CODEGRAPH_EMBEDDING_DIM'];
    else process.env['CODEGRAPH_EMBEDDING_DIM'] = savedDim;
    if (savedProvider === undefined) delete process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    else process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = savedProvider;
    vi.restoreAllMocks();
  });

  it('does not synthesize CODEGRAPH_EMBEDDING_DIM when only PROVIDER is set', async () => {
    process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = 'voyage';
    delete process.env['CODEGRAPH_EMBEDDING_DIM'];

    // Spy on spawnMCPClient to capture the env that would be passed
    const mcpBase = await import('../../src/adapters/_mcp-base.js');
    const spy = vi.spyOn(mcpBase, 'spawnMCPClient').mockImplementation(
      async (_cfg) => ({ close: async () => {}, callTool: async () => ({}) } as never),
    );

    const adapter = new CodeGraphAdapter({ dataDir });
    // Trigger getClient() via attach() with an empty corpus shape
    try {
      await adapter.attach({
        codeRoots: [{ language: 'typescript', path: dataDir, commitSha: 'test' }],
      });
    } catch {
      // attach() may throw because the mocked client doesn't return real data,
      // but spawnMCPClient gets called first. That's all this test cares about.
    }

    expect(spy).toHaveBeenCalled();
    const passedEnv = spy.mock.calls[0]![0].env as Record<string, string>;
    // The adapter must not synthesize a DIM value out of provider lookup.
    expect(passedEnv['CODEGRAPH_EMBEDDING_DIM']).toBeUndefined();
    // PROVIDER must still be forwarded.
    expect(passedEnv['CODEGRAPH_EMBEDDING_PROVIDER']).toBe('voyage');
  });

  it('forwards user-set CODEGRAPH_EMBEDDING_DIM unchanged', async () => {
    process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = 'voyage';
    process.env['CODEGRAPH_EMBEDDING_DIM'] = '1024';

    const mcpBase = await import('../../src/adapters/_mcp-base.js');
    const spy = vi.spyOn(mcpBase, 'spawnMCPClient').mockImplementation(
      async (_cfg) => ({ close: async () => {}, callTool: async () => ({}) } as never),
    );

    const adapter = new CodeGraphAdapter({ dataDir });
    try {
      await adapter.attach({
        codeRoots: [{ language: 'typescript', path: dataDir, commitSha: 'test' }],
      });
    } catch { /* see above */ }

    const passedEnv = spy.mock.calls[0]![0].env as Record<string, string>;
    expect(passedEnv['CODEGRAPH_EMBEDDING_DIM']).toBe('1024');
  });
});

describe('CodeGraphAdapter — B/C dispatch is pure search.find', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cg-bc-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('Task B query routes to search.find with action=find, not query+Cypher', async () => {
    const mcpBase = await import('../../src/adapters/_mcp-base.js');
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    vi.spyOn(mcpBase, 'spawnMCPClient').mockImplementation(
      async () => ({ close: async () => {}, callTool: async () => ({}) } as never),
    );
    vi.spyOn(mcpBase, 'callMCPTool').mockImplementation(
      async (_client, name, args, _timeoutMs) => {
        calls.push({ tool: name, args: args as Record<string, unknown> });
        if (name === 'search') return { results: [] };
        return {};
      },
    );

    const adapter = new CodeGraphAdapter({ dataDir });
    await adapter.query('classes that extend AuthBase', { task: 'B', topK: 10 });

    const toolNames = calls.map((c) => c.tool);
    expect(toolNames).toContain('search');
    expect(toolNames).not.toContain('query'); // no raw Cypher
    const searchCall = calls.find((c) => c.tool === 'search')!;
    expect(searchCall.args['action']).toBe('find');
    expect(searchCall.args['query']).toBe('classes that extend AuthBase');
  });

  it('Task C query routes to search.find with action=find, not query+Cypher', async () => {
    const mcpBase = await import('../../src/adapters/_mcp-base.js');
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    vi.spyOn(mcpBase, 'spawnMCPClient').mockImplementation(
      async () => ({ close: async () => {}, callTool: async () => ({}) } as never),
    );
    vi.spyOn(mcpBase, 'callMCPTool').mockImplementation(
      async (_client, name, args) => {
        calls.push({ tool: name, args: args as Record<string, unknown> });
        if (name === 'search') return { results: [] };
        return {};
      },
    );

    const adapter = new CodeGraphAdapter({ dataDir });
    await adapter.query('functions transitively affected if X changes', { task: 'C', topK: 10 });

    const toolNames = calls.map((c) => c.tool);
    expect(toolNames).toContain('search');
    expect(toolNames).not.toContain('query');
  });
});
