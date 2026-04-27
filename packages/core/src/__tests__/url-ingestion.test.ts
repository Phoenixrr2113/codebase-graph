import { describe, it, expect, vi } from 'vitest';
import { add } from '../documentIngestion';

const mockExtract = vi.fn(async () => ({ entities: 1, relationships: 0 }));

describe('URL ingestion', () => {
  it('fetches a text/html URL and dispatches to the HTML loader', async () => {
    const fetcher = vi.fn(async () => new Response('<html><body><h1>Title</h1><p>Body</p></body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));

    const result = await add('https://example.com/post', {
      _fetch: fetcher,
      _extractAndStore: mockExtract,
    });

    expect(fetcher).toHaveBeenCalledWith('https://example.com/post', expect.any(Object));
    expect(result.inputType).toBe('url');
    expect(result.metadata.contentType).toMatch(/^text\/html/);
    expect(result.metadata.url).toBe('https://example.com/post');
    expect(result.entities).toBeGreaterThan(0);
  });

  it('dispatches application/pdf URLs to the PDF loader', async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF" header
    const fetcher = vi.fn(async () => new Response(pdfBytes, {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    }));

    const result = await add('https://example.com/doc.pdf', {
      _fetch: fetcher,
      _extractAndStore: mockExtract,
    });

    expect(result.metadata.contentType).toBe('application/pdf');
  });

  it('throws a clean error on 4xx', async () => {
    const fetcher = vi.fn(async () => new Response('not found', { status: 404 }));
    await expect(add('https://example.com/missing', {
      _fetch: fetcher,
      _extractAndStore: mockExtract,
    })).rejects.toThrow(/404/);
  });

  it('records fetchedAt timestamp on the metadata', async () => {
    const fetcher = vi.fn(async () => new Response('<html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));
    const before = Date.now();
    const result = await add('https://example.com/', {
      _fetch: fetcher,
      _extractAndStore: mockExtract,
    });
    const after = Date.now();

    expect(result.metadata.fetchedAt).toBeDefined();
    const fetchedAt = result.metadata.fetchedAt as number;
    expect(fetchedAt).toBeGreaterThanOrEqual(before);
    expect(fetchedAt).toBeLessThanOrEqual(after);
  });
});
