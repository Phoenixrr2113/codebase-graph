/**
 * Embedding Generation — Unit Tests
 *
 * Tests both tiers:
 *   - Local: Real nomic-embed-text-v1.5 model (~10ms/embedding, no API key needed)
 *   - Cloud: Mocked (requires OPENROUTER_API_KEY in production)
 *   - Config resolution: provider selection, dimensions, availability
 */

import { describe, it, expect, afterAll } from 'vitest';
import {
  generateEmbedding,
  generateEmbeddings,
  getEmbeddingDimensions,
  getEmbeddingProvider,
  isEmbeddingAvailable,
  _resetLocalModel,
} from '../embeddings';

// ============================================================================
// Config / Utility
// ============================================================================

describe('Embedding config resolution', () => {
  const originalEnv = process.env['CODEGRAPH_EMBEDDING_PROVIDER'];

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    } else {
      process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = originalEnv;
    }
  });

  it('defaults to local provider', () => {
    delete process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    expect(getEmbeddingProvider()).toBe('local');
  });

  it('respects explicit config over env', () => {
    process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = 'openrouter';
    expect(getEmbeddingProvider({ provider: 'local' })).toBe('local');
  });

  it('respects env var when no explicit config', () => {
    process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = 'openrouter';
    expect(getEmbeddingProvider()).toBe('openrouter');
    delete process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
  });

  it('returns 768 dimensions for local provider', () => {
    expect(getEmbeddingDimensions({ provider: 'local' })).toBe(768);
  });

  it('returns 1536 dimensions for cloud provider', () => {
    expect(getEmbeddingDimensions({ provider: 'openrouter' })).toBe(1536);
  });

  it('local embeddings are always available', () => {
    expect(isEmbeddingAvailable({ provider: 'local' })).toBe(true);
  });

  it('cloud embeddings require OPENROUTER_API_KEY', () => {
    const originalKey = process.env['OPENROUTER_API_KEY'];
    delete process.env['OPENROUTER_API_KEY'];
    expect(isEmbeddingAvailable({ provider: 'openrouter' })).toBe(false);
    if (originalKey !== undefined) {
      process.env['OPENROUTER_API_KEY'] = originalKey;
    }
  });
});

// ============================================================================
// Local embedding generation (real model, no mocking)
// ============================================================================

describe('Local embedding generation', () => {
  afterAll(() => {
    _resetLocalModel();
  });

  it('generates a 768-dim embedding for a single text', async () => {
    const result = await generateEmbedding(
      'processPayment(amount: number, currency: string): Promise<PaymentResult>',
      { provider: 'local' },
    );

    expect(result.provider).toBe('local');
    expect(result.dimensions).toBe(768);
    expect(result.embedding).toHaveLength(768);
    expect(result.embedding.every((v) => typeof v === 'number' && !Number.isNaN(v))).toBe(true);
  });

  it('produces normalized embeddings (L2 norm ≈ 1.0)', async () => {
    const result = await generateEmbedding('test normalization', { provider: 'local' });
    const norm = Math.sqrt(result.embedding.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 2);
  });

  it('generates batch embeddings', async () => {
    const texts = [
      'processPayment function handles Stripe charges',
      'UserAuthController manages login sessions',
      'DatabaseConnection class with pooling',
    ];

    const result = await generateEmbeddings(texts, { provider: 'local' });

    expect(result.provider).toBe('local');
    expect(result.dimensions).toBe(768);
    expect(result.embeddings).toHaveLength(3);
    expect(result.embeddings.every((e) => e.length === 768)).toBe(true);
  });

  it('returns empty array for empty input', async () => {
    const result = await generateEmbeddings([], { provider: 'local' });
    expect(result.embeddings).toHaveLength(0);
    expect(result.dimensions).toBe(768);
  });

  it('produces different embeddings for different texts', async () => {
    const r1 = await generateEmbedding('payment processing', { provider: 'local' });
    const r2 = await generateEmbedding('authentication login', { provider: 'local' });

    // Cosine similarity (already normalized, so dot product = cosine sim)
    let dot = 0;
    for (let i = 0; i < r1.embedding.length; i++) {
      dot += r1.embedding[i]! * r2.embedding[i]!;
    }
    // Different texts should not be identical (sim < 1.0)
    expect(dot).toBeLessThan(0.99);
    // But should still be somewhat related (both are code concepts)
    expect(dot).toBeGreaterThan(0.1);
  });

  it('clusters semantically similar texts', async () => {
    const payment1 = await generateEmbedding('processPayment Stripe charges', { provider: 'local' });
    const payment2 = await generateEmbedding('chargeCustomer credit card billing', { provider: 'local' });
    const auth = await generateEmbedding('login authentication session JWT', { provider: 'local' });

    function dot(a: number[], b: number[]): number {
      let sum = 0;
      for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
      return sum;
    }

    const simPayments = dot(payment1.embedding, payment2.embedding);
    const simPaymentAuth = dot(payment1.embedding, auth.embedding);

    // Payment terms should be more similar to each other than to auth terms
    expect(simPayments).toBeGreaterThan(simPaymentAuth);
  });
});
