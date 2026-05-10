import { describe, expect, it } from 'vitest';
import { findBestMatch } from '../bridge-linker';

const minConfidence = 0.85;

describe('findBestMatch — stopword filtering', () => {
  const symbols = [
    { label: 'Function', name: 'new', nameLower: 'new' },
    { label: 'Function', name: 'get', nameLower: 'get' },
    { label: 'Function', name: 'send', nameLower: 'send' },
    { label: 'Function', name: 'resolve_redirects', nameLower: 'resolve_redirects' },
    { label: 'Class', name: 'ZodObject', nameLower: 'zodobject' },
    { label: 'Function', name: 'rebuildAuth', nameLower: 'rebuildauth' },
  ];

  it('does NOT contained-match common stopword names like "new"', () => {
    // Real cgbench failure: entity "update runbook with new retry defaults"
    // matched every Foo::new constructor in the Rust corpus.
    const m = findBestMatch('update runbook with new retry defaults', symbols, minConfidence);
    // Should NOT match `new` — it's in the stopword list. Should not match anything
    // unless another distinctive symbol is present in the text.
    expect(m).toBeNull();
  });

  it('does NOT contained-match common stopword names like "get"', () => {
    const m = findBestMatch('get the latest version of the report', symbols, minConfidence);
    expect(m).toBeNull();
  });

  it('does NOT contained-match common stopword names like "send"', () => {
    const m = findBestMatch('send the request and inspect the response', symbols, minConfidence);
    expect(m).toBeNull();
  });

  it('DOES contained-match distinctive symbol names', () => {
    const m = findBestMatch('the validation layer spec mentions ZodObject', symbols, minConfidence);
    expect(m).not.toBeNull();
    expect(m!.symbol.name).toBe('ZodObject');
  });

  it('DOES contained-match snake_case symbol names', () => {
    const m = findBestMatch('the resolve_redirects method handles 3xx responses', symbols, minConfidence);
    expect(m).not.toBeNull();
    expect(m!.symbol.name).toBe('resolve_redirects');
  });

  it('exact match wins regardless of stopword status', () => {
    // If the entire entity text IS the stopword (rare but possible), exact
    // match still works because that's tier 1 / 2.
    const m = findBestMatch('new', symbols, minConfidence);
    expect(m).not.toBeNull();
    expect(m!.symbol.name).toBe('new');
    expect(m!.confidence).toBe(1.0);
  });

  it('case-insensitive match works for distinctive names', () => {
    const m = findBestMatch('zodobject', symbols, minConfidence);
    expect(m).not.toBeNull();
    expect(m!.symbol.name).toBe('ZodObject');
    expect(m!.confidence).toBe(0.95);
  });

  it('rejects symbol names < 5 chars at tier 3 even if not a stopword', () => {
    const shortSymbols = [{ label: 'Function', name: 'load', nameLower: 'load' }];
    // 'load' is 4 chars — below the 5-char minimum and would be too generic anyway
    const m = findBestMatch('we need to load the configuration before bootstrapping', shortSymbols, minConfidence);
    expect(m).toBeNull();
  });
});
