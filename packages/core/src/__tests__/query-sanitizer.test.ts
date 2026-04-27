import { describe, it, expect } from 'vitest';
import { sanitizeQuery } from '../querySanitizer';

describe('sanitizeQuery', () => {
  it('passthrough for short queries (≤200 chars)', () => {
    const r = sanitizeQuery('parseProject');
    expect(r.query).toBe('parseProject');
    expect(r.warnings).toEqual([]);
  });

  it('extracts the last ?-terminated sentence when query exceeds 200 chars', () => {
    const longPrompt = 'You are a helpful assistant. '.repeat(20);
    const input = longPrompt + 'What does parseProject do?';
    const r = sanitizeQuery(input);
    expect(r.query).toBe('What does parseProject do?');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('falls back to last sentence when no ? present', () => {
    const longPrompt = 'You are a helpful assistant. '.repeat(20);
    const input = longPrompt + 'Find authentication functions.';
    const r = sanitizeQuery(input);
    expect(r.query).toBe('Find authentication functions.');
  });

  it('truncates to last 200 chars when no sentence boundary at all', () => {
    const longInput = 'a'.repeat(500);
    const r = sanitizeQuery(longInput);
    expect(r.query.length).toBeLessThanOrEqual(200);
  });

  it('trims whitespace', () => {
    const r = sanitizeQuery('   parseProject   ');
    expect(r.query).toBe('parseProject');
  });

  it('returns warnings array describing what changed', () => {
    const longPrompt = 'You are a helpful assistant. '.repeat(20);
    const input = longPrompt + 'What does parseProject do?';
    const r = sanitizeQuery(input);
    expect(r.warnings.some(w => w.toLowerCase().includes('extracted'))).toBe(true);
  });

  it('handles empty input by returning empty query and warning', () => {
    const r = sanitizeQuery('');
    expect(r.query).toBe('');
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
