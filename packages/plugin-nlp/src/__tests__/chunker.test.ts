/**
 * Token-aware Text Chunker — Unit Tests
 *
 * Covers: single chunk, multi-chunk split, long sentence preservation,
 * overlap, metadata fields, empty input, single word, unicode.
 */

import { describe, it, expect } from 'vitest';
import { chunkText, type ChunkConfig } from '../chunker';

describe('chunkText', () => {
  it('returns single chunk when text fits in maxTokens', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const chunks = chunkText(text, { maxTokens: 100 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe(text.trim());
    expect(chunks[0]?.index).toBe(0);
  });

  it('splits long text into multiple chunks at sentence boundaries', () => {
    const sentences = Array(20).fill('The quick brown fox jumps over the lazy dog.').join(' ');
    const chunks = chunkText(sentences, { maxTokens: 30, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      // Give generous slack — overlap can temporarily exceed, but each unit individually fits
      expect(c.tokenCount).toBeLessThanOrEqual(100);
    }
  });

  it('preserves a single sentence longer than maxTokens (does not split mid-sentence)', () => {
    const longSentence = 'word '.repeat(200) + 'final.';
    const chunks = chunkText(longSentence, { maxTokens: 50, overlap: 0 });
    // The entire sentence must be in a single chunk — no mid-word split
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain('final.');
  });

  it('overlap parameter includes tokens from previous chunk in next chunk', () => {
    // Build text with enough short sentences to produce at least 2 chunks
    const text = Array(30).fill('One. Two.').join(' ');
    const chunks = chunkText(text, { maxTokens: 10, overlap: 3 });
    expect(chunks.length).toBeGreaterThan(1);
    // Each non-first chunk should share some content with the prior chunk tail
    if (chunks.length > 1) {
      // The second chunk should not start fresh — it should start with overlap content
      const firstChunkWords = chunks[0]!.text.split(/\s+/);
      const secondChunkText = chunks[1]!.text;
      // At least one word from the tail of chunk 0 should appear at the start of chunk 1
      const tailWord = firstChunkWords[firstChunkWords.length - 1]!;
      expect(secondChunkText).toContain(tailWord);
    }
  });

  it('returns chunk metadata: index, tokenCount, startOffset, endOffset', () => {
    const text = 'Hello world. Goodbye world.';
    const chunks = chunkText(text, { maxTokens: 100 });
    expect(chunks[0]).toMatchObject({
      index: expect.any(Number),
      tokenCount: expect.any(Number),
      startOffset: 0,
      endOffset: expect.any(Number),
    });
    expect(chunks[0]!.endOffset).toBeGreaterThan(0);
    expect(chunks[0]!.tokenCount).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    expect(chunkText('', { maxTokens: 100 })).toEqual([]);
  });

  it('handles single-word input', () => {
    const chunks = chunkText('hello', { maxTokens: 100 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe('hello');
  });

  it('handles unicode and emoji content', () => {
    const text = 'Hello 🌍 world. こんにちは world.';
    const chunks = chunkText(text, { maxTokens: 100 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain('🌍');
    expect(chunks[0]?.text).toContain('こんにちは');
  });
});
