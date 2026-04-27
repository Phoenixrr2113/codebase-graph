/**
 * Document Ingestion — Unit Tests
 *
 * Tests the unified add() entry point using DI hooks to avoid
 * real database connections, file system access, and network calls.
 *
 * Covers: raw text ingestion, URL routing, file path routing,
 * unsupported extension rejection.
 */

import { describe, it, expect, vi } from 'vitest';
import { add } from '../documentIngestion';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExtractAndStore(overrides?: Partial<{ entities: number; relationships: number }>) {
  return vi.fn().mockResolvedValue({
    entities: overrides?.entities ?? 1,
    relationships: overrides?.relationships ?? 0,
  });
}

function makeLoader(text: string, format = 'pdf') {
  return {
    extensions: [format],
    extract: vi.fn().mockResolvedValue({
      text,
      metadata: { format },
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('add()', () => {
  it('detects raw text and ingests via chunker + extractAndStore', async () => {
    const mockExtract = makeExtractAndStore({ entities: 1 });

    const result = await add('Plain text input about JWT authentication.', {
      _extractAndStore: mockExtract,
    });

    expect(mockExtract).toHaveBeenCalled();
    expect(result.chunks).toBeGreaterThanOrEqual(1);
    expect(result.entities).toBeGreaterThanOrEqual(1);
    expect(result.inputType).toBe('text');
  });

  it('detects URL prefix and routes through fetch + html loader', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html><body><p>Hello world from URL</p></body></html>',
    }) as unknown as typeof globalThis.fetch;

    const mockExtract = makeExtractAndStore();

    const result = await add('https://example.com/page', {
      _fetch: mockFetch,
      _extractAndStore: mockExtract,
    });

    expect(mockFetch).toHaveBeenCalledWith('https://example.com/page');
    expect(mockExtract).toHaveBeenCalled();
    expect(result.inputType).toBe('url');
    expect(result.chunks).toBeGreaterThanOrEqual(1);
  });

  it('throws on failed URL fetch', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof globalThis.fetch;

    await expect(
      add('https://example.com/missing', {
        _fetch: mockFetch,
        _extractAndStore: makeExtractAndStore(),
      })
    ).rejects.toThrow(/URL fetch failed/i);
  });

  it('detects file path with known extension and routes to loader', async () => {
    const mockLoader = makeLoader('PDF body text extracted from the document', 'pdf');
    const mockExtract = makeExtractAndStore();

    const result = await add('/tmp/sample.pdf', {
      _loader: mockLoader,
      _extractAndStore: mockExtract,
    });

    expect(mockLoader.extract).toHaveBeenCalledWith('/tmp/sample.pdf');
    expect(mockExtract).toHaveBeenCalled();
    expect(result.inputType).toBe('file');
  });

  it('rejects unsupported extensions with a clear error', async () => {
    await expect(add('/tmp/file.xyz', {})).rejects.toThrow(/unsupported/i);
  });

  it('accumulates entities from multiple chunks', async () => {
    // 3 calls to extractAndStore → 3 entities total
    const mockExtract = vi.fn().mockResolvedValue({ entities: 1, relationships: 0 });

    // Create text long enough to produce multiple chunks (roughly 3+)
    const longText = Array(60)
      .fill('The quick brown fox jumps over the lazy dog.')
      .join(' ');

    const result = await add(longText, {
      maxTokens: 50,
      _extractAndStore: mockExtract,
    });

    expect(result.chunks).toBeGreaterThan(1);
    expect(mockExtract).toHaveBeenCalledTimes(result.chunks);
    expect(result.entities).toBe(result.chunks); // 1 entity per chunk
  });

  it('returns source label in result when provided', async () => {
    const result = await add('Simple test text for source label.', {
      source: 'manual-test',
      _extractAndStore: makeExtractAndStore(),
    });

    expect(result.source).toBe('manual-test');
  });

  it('handles empty text gracefully — returns zero chunks', async () => {
    const mockExtract = makeExtractAndStore();

    const result = await add('   ', {
      _extractAndStore: mockExtract,
    });

    expect(result.chunks).toBe(0);
    expect(result.entities).toBe(0);
    expect(mockExtract).not.toHaveBeenCalled();
  });
});
