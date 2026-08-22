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
  createResponseCompatibleFetch,
  generateEmbedding,
  generateEmbeddings,
  getEmbeddingDimensions,
  getEmbeddingProfile,
  getEmbeddingProvider,
  getLocalEmbeddingModelState,
  isEmbeddingAvailable,
  _resetLocalModel,
} from '../embeddings';

// ============================================================================
// Config / Utility
// ============================================================================

describe('Embedding config resolution', () => {
  const originalEnv = process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
  const originalVoyageKey = process.env['VOYAGE_API_KEY'];
  const originalOpenRouterKey = process.env['OPENROUTER_API_KEY'];

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    } else {
      process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = originalEnv;
    }

    if (originalVoyageKey === undefined) {
      delete process.env['VOYAGE_API_KEY'];
    } else {
      process.env['VOYAGE_API_KEY'] = originalVoyageKey;
    }

    if (originalOpenRouterKey === undefined) {
      delete process.env['OPENROUTER_API_KEY'];
    } else {
      process.env['OPENROUTER_API_KEY'] = originalOpenRouterKey;
    }
  });

  it('defaults to the 768 dimension local profile when no provider or key is set', () => {
    delete process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    delete process.env['VOYAGE_API_KEY'];
    delete process.env['OPENROUTER_API_KEY'];

    expect(getEmbeddingProvider()).toBe('local');
    expect(getEmbeddingDimensions()).toBe(768);
    expect(isEmbeddingAvailable()).toBe(true);
    expect(getEmbeddingProfile()).toEqual({
      provider: 'local',
      model: 'nomic-ai/nomic-embed-text-v1.5',
      dimension: 768,
    });
  });

  it('returns none dimensions as 0', () => {
    expect(getEmbeddingDimensions({ provider: 'none' })).toBe(0);
  });

  it('none provider is not available', () => {
    expect(isEmbeddingAvailable({ provider: 'none' })).toBe(false);
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

describe('Transformers.js response compatibility', () => {
  it('rewraps fetched model responses when the active Response constructor differs', async () => {
    class BundledResponse extends Response {}
    const nativeResponse = new Response('model-bytes', {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    });
    const fetcher: typeof globalThis.fetch = async () => nativeResponse;

    const response = await createResponseCompatibleFetch(fetcher, BundledResponse)('https://example.test/model.onnx');

    expect(response).toBeInstanceOf(BundledResponse);
    expect(await response.text()).toBe('model-bytes');
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

  it('surfaces observable byte progress while the local model loads', async () => {
    _resetLocalModel();
    const updates: Array<{ state: string; loadedBytes?: number; totalBytes?: number }> = [];

    await generateEmbedding('observable model load', {
      provider: 'local',
      onLoadProgress: (progress) => updates.push(progress),
    });

    expect(updates.some((progress) => (progress.loadedBytes ?? 0) > 0)).toBe(true);
    expect(updates.at(-1)?.state).toBe('ready');
    expect(getLocalEmbeddingModelState().state).toBe('ready');
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
