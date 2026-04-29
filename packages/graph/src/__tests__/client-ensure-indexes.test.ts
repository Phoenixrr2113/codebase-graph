/**
 * Unit tests for GraphClientImpl.ensureIndexes() dim conflict guard.
 *
 * These tests exercise the INDEX_DIM_CONFLICT error that is thrown when a
 * second call to ensureIndexes() passes a different embeddingDim than the
 * first call. No real FalkorDB connection is required — a stub driver is used.
 */

import { describe, it, expect } from 'vitest';
import { GraphClientError } from '../client';
import type { DatabaseDriver, DriverConfig, CypherDialect } from '../driver';
import type { QueryParams, QueryResult } from '../client';

// ============================================================================
// Stub driver — succeeds for ensureSchema, no-ops everything else
// ============================================================================

class StubDriver implements DatabaseDriver {
  readonly dialect: CypherDialect = {
    // Minimal dialect stub — tests never call these
    createVectorIndex: () => '',
    vectorSearch: () => '',
    upsertNode: () => '',
    mergeEdge: () => '',
  } as unknown as CypherDialect;

  async connect(_config: DriverConfig): Promise<void> {
    // no-op
  }

  async query<T>(_cypher: string, _params?: QueryParams, _timeout?: number): Promise<QueryResult<T>> {
    return { data: [], metadata: [] };
  }

  async roQuery<T>(_cypher: string, _params?: QueryParams, _timeout?: number): Promise<QueryResult<T>> {
    return { data: [], metadata: [] };
  }

  async ensureSchema(_opts?: { embeddingDim?: number }): Promise<void> {
    // no-op — schema always succeeds
  }

  async close(): Promise<void> {
    // no-op
  }
}

// ============================================================================
// createClient-level test helper using the real factory path via duck-typing.
// We cannot import GraphClientImpl directly (it is not exported), so we obtain
// a real GraphClient instance by calling the exported createClient factory with
// a driver shim injected via the internal module path.
//
// Instead, we exercise the behaviour through the GraphClient interface returned
// by a minimal createClient call, which is what callers actually use.
//
// To avoid needing a real DB, we import the class internals indirectly by
// constructing the object ourselves via a dynamic require of the module, which
// lets us call the private constructor. Alternatively we test at the integration
// boundary: createClient produces a GraphClient; we call ensureIndexes on it.
//
// Since createClient() calls driver.connect() synchronously before returning,
// we need the stub driver to be injected at the module level. The simplest
// approach: patch the module's internal driver classes by re-exporting via a
// test-local factory. This avoids mocking framework complexity.
//
// We take the simplest correct path: inline-construct GraphClientImpl by
// accessing the non-exported class via a dynamic import of the module's
// internal symbols. Since TS strict mode prevents accessing unexported names,
// we instead test through a thin re-export added only for tests.
//
// The pragmatic solution for a private class: test through createClient() with
// a mock that uses falkordblite if available, otherwise skip. BUT since the
// dim-conflict guard is pure in-memory logic (no DB I/O after schemaCreated=true),
// we can test it via any real GraphClient. We call ensureIndexes(768) once using
// the real falkordblite path, then call it again with 1024 and expect the throw.
// ============================================================================

// For pure unit testing of the in-memory guard, we re-test by importing the
// GraphClientImpl indirectly: the module uses a named-export createClient that
// internally constructs the class. We instrument by bypassing real drivers
// through the module's exported GraphClient interface.
//
// Since TS won't let us reach GraphClientImpl without an export, we test via a
// thin production path: pass a driver stub to a re-exported factory function.
// The module does NOT export GraphClientImpl, so we add a test-only export path
// by directly testing the behaviour observable through the public GraphClient
// interface returned by createClient().
//
// Simplest correct approach: mock the FalkorDBLiteDriver class's connect/ensureSchema
// to avoid real I/O, then use createClient({ driver: 'falkordblite' }).
// We achieve this by importing and monkey-patching the prototype BEFORE createClient
// is called in the test.

import { createClient } from '../client';
import { FalkorDBLiteDriver } from '../drivers/falkordblite';

// Patch FalkorDBLiteDriver prototype so no real redis process is spawned.
// Safe because each test in this file uses its own patched instance.
function installStubOnLiteDriver(): void {
  (FalkorDBLiteDriver.prototype as unknown as Record<string, unknown>)['connect'] =
    async (_config: DriverConfig): Promise<void> => { /* no-op */ };
  (FalkorDBLiteDriver.prototype as unknown as Record<string, unknown>)['ensureSchema'] =
    async (_opts?: { embeddingDim?: number }): Promise<void> => { /* no-op */ };
  (FalkorDBLiteDriver.prototype as unknown as Record<string, unknown>)['query'] =
    async <T>(): Promise<QueryResult<T>> => ({ data: [], metadata: [] });
  (FalkorDBLiteDriver.prototype as unknown as Record<string, unknown>)['roQuery'] =
    async <T>(): Promise<QueryResult<T>> => ({ data: [], metadata: [] });
  (FalkorDBLiteDriver.prototype as unknown as Record<string, unknown>)['close'] =
    async (): Promise<void> => { /* no-op */ };
}

describe('GraphClientImpl.ensureIndexes() dim conflict guard', () => {
  installStubOnLiteDriver();

  it('first call with embeddingDim succeeds', async () => {
    const client = await createClient({ driver: 'falkordblite', databasePath: '/tmp/test-dim-guard-1' });
    await expect(client.ensureIndexes({ embeddingDim: 768 })).resolves.toBeUndefined();
    await client.close();
  });

  it('second call with the same embeddingDim is a no-op (no throw)', async () => {
    const client = await createClient({ driver: 'falkordblite', databasePath: '/tmp/test-dim-guard-2' });
    await client.ensureIndexes({ embeddingDim: 768 });
    await expect(client.ensureIndexes({ embeddingDim: 768 })).resolves.toBeUndefined();
    await client.close();
  });

  it('second call with a different embeddingDim throws INDEX_DIM_CONFLICT', async () => {
    const client = await createClient({ driver: 'falkordblite', databasePath: '/tmp/test-dim-guard-3' });
    await client.ensureIndexes({ embeddingDim: 768 });
    await expect(client.ensureIndexes({ embeddingDim: 1024 })).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof GraphClientError &&
        err.code === 'INDEX_DIM_CONFLICT' &&
        err.message.includes('768') &&
        err.message.includes('1024'),
    );
    await client.close();
  });

  it('second call with no opts is always a no-op (no throw)', async () => {
    const client = await createClient({ driver: 'falkordblite', databasePath: '/tmp/test-dim-guard-4' });
    await client.ensureIndexes({ embeddingDim: 768 });
    await expect(client.ensureIndexes()).resolves.toBeUndefined();
    await client.close();
  });

  it('second call with undefined embeddingDim is a no-op (no throw)', async () => {
    const client = await createClient({ driver: 'falkordblite', databasePath: '/tmp/test-dim-guard-5' });
    await client.ensureIndexes({ embeddingDim: 768 });
    await expect(client.ensureIndexes({ embeddingDim: undefined })).resolves.toBeUndefined();
    await client.close();
  });
});
