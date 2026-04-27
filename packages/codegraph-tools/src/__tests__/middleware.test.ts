import { describe, it, expect, vi } from 'vitest';
import { withCodeGraph } from '../vercel';
import { createCodeGraphProcessor } from '../mastra';
import type { SearchHit } from '../vercel';

// ============================================================================
// withCodeGraph — Vercel AI SDK middleware
// ============================================================================

describe('withCodeGraph (Vercel AI SDK middleware)', () => {
  it('returns a wrapped model object', () => {
    const base: Record<string, unknown> = {
      doGenerate: vi.fn().mockResolvedValue({ text: 'response' }),
      modelId: 'gpt-4',
      provider: 'openai',
    };
    const wrapped = withCodeGraph(base, { projectPath: '/test', _searchFn: vi.fn() });
    expect(wrapped).toBeDefined();
    expect(typeof (wrapped as Record<string, unknown>)['doGenerate']).toBe('function');
  });

  it('passes through when no code-search-shaped query is detected', async () => {
    const doGenerate = vi.fn().mockResolvedValue({ text: 'hi' });
    const base: Record<string, unknown> = { doGenerate, modelId: 'gpt-4', provider: 'openai' };
    const search = vi.fn();
    const wrapped = withCodeGraph(base, { projectPath: '/test', _searchFn: search });

    await (wrapped as { doGenerate: (p: unknown) => Promise<unknown> }).doGenerate({
      prompt: [{ role: 'user', content: 'Hello there!' }],
    });

    expect(doGenerate).toHaveBeenCalled();
    // Non-code-search prompt should NOT trigger search
    expect(search).not.toHaveBeenCalled();
  });

  it('injects search results when user asks a code-search-shaped question', async () => {
    const hits: SearchHit[] = [
      { name: 'parseProject', filePath: '/src/x.ts', score: 0.9, signature: 'parseProject(): void' },
    ];
    const search = vi.fn().mockResolvedValue(hits);
    const doGenerate = vi.fn().mockResolvedValue({ text: 'response' });
    const base: Record<string, unknown> = { doGenerate, modelId: 'gpt-4', provider: 'openai' };
    const wrapped = withCodeGraph(base, { projectPath: '/test', _searchFn: search });

    await (wrapped as { doGenerate: (p: unknown) => Promise<unknown> }).doGenerate({
      prompt: [{ role: 'user', content: 'where is parseProject defined?' }],
    });

    expect(search).toHaveBeenCalled();
    const callArgs = doGenerate.mock.calls[0]?.[0] as Record<string, unknown>;
    const prompt = callArgs['prompt'] as Array<{ role: string; content: string }>;
    const systemMsg = prompt.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('parseProject');
    expect(systemMsg?.content).toContain('CodeGraph search context');
  });

  it('passes through cleanly when search returns no hits', async () => {
    const search = vi.fn().mockResolvedValue([]);
    const doGenerate = vi.fn().mockResolvedValue({ text: 'ok' });
    const base: Record<string, unknown> = { doGenerate, modelId: 'gpt-4', provider: 'openai' };
    // Use a unique projectPath so the module-level cache doesn't cross-contaminate
    const wrapped = withCodeGraph(base, {
      projectPath: '/test-no-hits-' + Math.random(),
      _searchFn: search,
    });

    await (wrapped as { doGenerate: (p: unknown) => Promise<unknown> }).doGenerate({
      prompt: [{ role: 'user', content: 'where is emptyResultFunc defined?' }],
    });

    const callArgs = doGenerate.mock.calls[0]?.[0] as Record<string, unknown>;
    const prompt = callArgs['prompt'] as Array<{ role: string }>;
    // No system message injected when search returns empty
    expect(prompt.every((m) => m.role !== 'system')).toBe(true);
  });

  it('uses cache on repeated identical queries', async () => {
    const hits: SearchHit[] = [
      { name: 'myFunc', filePath: '/src/y.ts', score: 0.8 },
    ];
    const search = vi.fn().mockResolvedValue(hits);
    const doGenerate = vi.fn().mockResolvedValue({ text: 'ok' });
    const base: Record<string, unknown> = { doGenerate, modelId: 'gpt-4', provider: 'openai' };
    const wrapped = withCodeGraph(base, {
      projectPath: '/cache-test-' + Math.random(),
      _searchFn: search,
    });

    const prompt = [{ role: 'user', content: 'where is myFunc defined?' }];
    const fn = wrapped as { doGenerate: (p: unknown) => Promise<unknown> };

    await fn.doGenerate({ prompt });
    await fn.doGenerate({ prompt });

    // Second call should use cache — search only called once
    expect(search).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// createCodeGraphProcessor — Mastra processor
// ============================================================================

describe('createCodeGraphProcessor (Mastra processor)', () => {
  it('returns a processor with a name and process function', () => {
    const processor = createCodeGraphProcessor({ projectPath: '/test' });
    expect(processor.name).toBe('codegraph-context');
    expect(typeof processor.process).toBe('function');
  });

  it('injects a system message with search results', async () => {
    const hits: SearchHit[] = [
      { name: 'doAuth', filePath: '/src/auth.ts', score: 0.95 },
    ];
    const processor = createCodeGraphProcessor({
      projectPath: '/test',
      _searchFn: vi.fn().mockResolvedValue(hits),
    });

    const input = {
      messages: [{ role: 'user', content: 'how does doAuth work?' }],
    };
    const result = await processor.process(input);
    expect(result.messages[0]?.role).toBe('system');
    expect(result.messages[0]?.content).toContain('CodeGraph context');
    expect(result.messages[0]?.content).toContain('doAuth');
  });

  it('passes through unchanged when messages is empty', async () => {
    const processor = createCodeGraphProcessor({ _searchFn: vi.fn() });
    const input = { messages: [] };
    const result = await processor.process(input);
    expect(result.messages).toHaveLength(0);
  });

  it('passes through when search returns no hits', async () => {
    const processor = createCodeGraphProcessor({
      _searchFn: vi.fn().mockResolvedValue([]),
    });
    const input = { messages: [{ role: 'user', content: 'how does X work?' }] };
    const result = await processor.process(input);
    // No system message prepended
    expect(result.messages).toHaveLength(1);
  });
});
