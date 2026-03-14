/**
 * Tests for the lazy grammar loader.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadGrammar, getLoadedGrammar, isGrammarAvailable, clearGrammarCache } from '../grammar-loader';

describe('Grammar Loader', () => {
  beforeEach(() => {
    clearGrammarCache();
  });

  it('should return undefined for non-existent packages', async () => {
    const grammar = await loadGrammar('tree-sitter-nonexistent-language-xyz');
    expect(grammar).toBeUndefined();
  });

  it('should cache failed packages and not retry', async () => {
    const pkg = 'tree-sitter-definitely-not-real';
    const result1 = await loadGrammar(pkg);
    expect(result1).toBeUndefined();

    // Second call should return immediately without retrying
    const result2 = await loadGrammar(pkg);
    expect(result2).toBeUndefined();
  });

  it('should return undefined for getLoadedGrammar when not loaded', () => {
    const result = getLoadedGrammar('tree-sitter-some-language');
    expect(result).toBeUndefined();
  });

  it('should report unavailable for missing grammars', async () => {
    const available = await isGrammarAvailable('tree-sitter-nonexistent-xyz');
    expect(available).toBe(false);
  });

  it('should clear cache properly', async () => {
    // Load a non-existent package to add to failed set
    await loadGrammar('tree-sitter-nonexistent-abc');

    // Clear should reset everything
    clearGrammarCache();

    // getLoadedGrammar should return undefined for all
    expect(getLoadedGrammar('tree-sitter-nonexistent-abc')).toBeUndefined();
  });
});
