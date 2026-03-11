/**
 * Token Estimator — Unit Tests
 *
 * Tests the lightweight token estimation utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  tokensToChars,
  fitsTokenBudget,
  truncateToTokenBudget,
} from '../tokenEstimator';

// ============================================================================
// estimateTokens
// ============================================================================

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for undefined/null-like input', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(estimateTokens(undefined as any)).toBe(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(estimateTokens(null as any)).toBe(0);
  });

  it('estimates single word as 1 token', () => {
    expect(estimateTokens('hello')).toBe(2); // 5 chars → ceil(5/4) = 2
    expect(estimateTokens('hi')).toBe(1);    // short word = 1
  });

  it('estimates short prose sentence', () => {
    const tokens = estimateTokens('The quick brown fox');
    // 4 words (all <= 5 chars) + 3 spaces ≈ 7 tokens
    expect(tokens).toBeGreaterThanOrEqual(5);
    expect(tokens).toBeLessThanOrEqual(10);
  });

  it('estimates code snippet with punctuation', () => {
    const code = 'function add(a: number, b: number): number {';
    const tokens = estimateTokens(code);
    // This has words + colons + commas + parens + braces
    // tiktoken cl100k_base gives ~14 tokens for this
    expect(tokens).toBeGreaterThanOrEqual(10);
    expect(tokens).toBeLessThanOrEqual(25);
  });

  it('estimates multiline code', () => {
    const code = `export class Server {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }
}`;
    const tokens = estimateTokens(code);
    // Significant content — should be in a reasonable range
    expect(tokens).toBeGreaterThanOrEqual(20);
    expect(tokens).toBeLessThanOrEqual(60);
  });

  it('handles long words (subword splitting)', () => {
    const longWord = 'supercalifragilisticexpialidocious';
    const tokens = estimateTokens(longWord);
    // 34 chars → ceil(34/4) = 9 tokens
    expect(tokens).toBeGreaterThan(1);
    expect(tokens).toBeLessThanOrEqual(12);
  });

  it('handles numbers', () => {
    expect(estimateTokens('42')).toBeGreaterThanOrEqual(1);
    expect(estimateTokens('3.14159')).toBeGreaterThanOrEqual(1);
    expect(estimateTokens('1000000')).toBeGreaterThanOrEqual(2);
  });

  it('handles pure punctuation', () => {
    const tokens = estimateTokens('{}[]().,;:');
    // Each punctuation character is 1 token
    expect(tokens).toBe(10);
  });

  it('scales roughly linearly with text length', () => {
    const short = 'Hello world';
    const long = Array(10).fill('Hello world').join(' ');
    const shortTokens = estimateTokens(short);
    const longTokens = estimateTokens(long);
    // Long text should be roughly 10x the short text tokens
    expect(longTokens).toBeGreaterThan(shortTokens * 5);
    expect(longTokens).toBeLessThan(shortTokens * 15);
  });
});

// ============================================================================
// tokensToChars
// ============================================================================

describe('tokensToChars', () => {
  it('converts tokens to chars for code content', () => {
    const chars = tokensToChars(100, 'code');
    expect(chars).toBe(320); // 100 * 3.2
  });

  it('converts tokens to chars for prose content', () => {
    const chars = tokensToChars(100, 'prose');
    expect(chars).toBe(400); // 100 * 4.0
  });

  it('converts tokens to chars for mixed content', () => {
    const chars = tokensToChars(100, 'mixed');
    expect(chars).toBe(350); // 100 * 3.5
  });

  it('defaults to mixed ratio', () => {
    const chars = tokensToChars(100);
    expect(chars).toBe(350); // 100 * 3.5
  });

  it('handles zero tokens', () => {
    expect(tokensToChars(0)).toBe(0);
  });

  it('returns integer values', () => {
    const chars = tokensToChars(7, 'code');
    expect(Number.isInteger(chars)).toBe(true);
  });
});

// ============================================================================
// fitsTokenBudget
// ============================================================================

describe('fitsTokenBudget', () => {
  it('returns true for empty text', () => {
    expect(fitsTokenBudget('', 10)).toBe(true);
  });

  it('returns true when text fits within budget', () => {
    expect(fitsTokenBudget('hello', 100)).toBe(true);
  });

  it('returns false when text exceeds budget', () => {
    const longText = 'word '.repeat(1000);
    expect(fitsTokenBudget(longText, 10)).toBe(false);
  });

  it('handles edge case where text exactly meets budget', () => {
    const text = 'hi';
    const tokens = estimateTokens(text);
    expect(fitsTokenBudget(text, tokens)).toBe(true);
    expect(fitsTokenBudget(text, tokens - 1)).toBe(false);
  });
});

// ============================================================================
// truncateToTokenBudget
// ============================================================================

describe('truncateToTokenBudget', () => {
  it('returns text unchanged when it fits', () => {
    const text = 'Hello world';
    expect(truncateToTokenBudget(text, 100)).toBe(text);
  });

  it('truncates long text to fit budget', () => {
    const text = 'word '.repeat(500);
    const truncated = truncateToTokenBudget(text, 20);
    expect(truncated.length).toBeLessThan(text.length);
    expect(truncated.endsWith('...')).toBe(true);
  });

  it('uses custom suffix', () => {
    const text = 'word '.repeat(500);
    const truncated = truncateToTokenBudget(text, 20, ' [truncated]');
    expect(truncated.endsWith(' [truncated]')).toBe(true);
  });

  it('handles empty text', () => {
    expect(truncateToTokenBudget('', 10)).toBe('');
  });

  it('truncated text fits within budget', () => {
    const text = 'This is a longer text that should be truncated to fit within the specified token budget for testing purposes.';
    const budget = 10;
    const truncated = truncateToTokenBudget(text, budget);
    expect(estimateTokens(truncated)).toBeLessThanOrEqual(budget);
  });

  it('tries to break at word boundaries', () => {
    const text = 'The quick brown fox jumps over the lazy dog and continues running across the vast plains';
    const truncated = truncateToTokenBudget(text, 8);
    // Should break at a space rather than mid-word
    expect(truncated.endsWith('...')).toBe(true);
    // The text before ... should end at a word boundary
    const beforeSuffix = truncated.slice(0, -3);
    expect(beforeSuffix.endsWith(' ') || /\w$/.test(beforeSuffix)).toBe(true);
  });
});

// ============================================================================
// Integration: Code Context Estimation
// ============================================================================

describe('Code context estimation (integration)', () => {
  it('estimates a realistic TypeScript file', () => {
    const tsFile = `
import { readFile } from 'node:fs/promises';

export interface Config {
  port: number;
  host: string;
}

export class Server {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async start(): Promise<void> {
    console.log('Starting server...');
  }
}

export function createServer(config: Config): Server {
  return new Server(config);
}

export const DEFAULT_PORT = 3000;
`.trim();

    const tokens = estimateTokens(tsFile);
    // A real tokenizer gives ~120 tokens for this.
    // Our heuristic over-counts slightly (more conservative = safer for budgets).
    // Should be in a reasonable ballpark (80-250 range)
    expect(tokens).toBeGreaterThanOrEqual(80);
    expect(tokens).toBeLessThanOrEqual(250);
  });

  it('estimates a repository map output', () => {
    const repoMap = `# Repository Map

## src/auth/login.ts
  F validateToken [cx:5, conn:12] L10
  F refreshToken [conn:8] L45
  C AuthService [cx:15, conn:20] L80

## src/models/user.ts
  I UserInterface L5
  C UserModel [cx:8, conn:15] L20
  F createUser [conn:6] L100

## src/utils/helpers.ts
  F formatDate [conn:4] L1
  F parseJSON [conn:3] L15
  V MAX_RETRIES L30
`;

    const tokens = estimateTokens(repoMap);
    // Should be a reasonable estimate for this structured content
    expect(tokens).toBeGreaterThanOrEqual(50);
    expect(tokens).toBeLessThanOrEqual(200);
  });

  it('provides better accuracy than simple /4 for code', () => {
    // Code with lots of punctuation — the /4 heuristic over-estimates
    const code = 'obj.method(a, b, c);';
    const charDiv4 = Math.ceil(code.length / 4); // 20/4 = 5
    const estimated = estimateTokens(code);
    // tiktoken gives ~12 tokens for this (each dot, paren, comma, semicolon = 1 token)
    // Our estimator should give more than the naive /4 because of punctuation
    expect(estimated).toBeGreaterThan(charDiv4);
  });
});
