import { describe, expect, it, vi } from 'vitest';
import type { GraphClient } from '@codegraph/graph';
import { getSetupStatus } from '../setup-status';

describe('getSetupStatus', () => {
  it('returns the frozen runtime contract and a provider migration requirement', async () => {
    const storedProfile = { provider: 'voyage', model: 'voyage-code-3', dimension: 1024 } as const;
    const requestedProfile = {
      provider: 'local',
      model: 'nomic-ai/nomic-embed-text-v1.5',
      dimension: 768,
    } as const;
    const client = {
      storage: {
        driver: 'falkordblite',
        dataPath: '/private/tmp/codegraph-setup-contract',
        ownerState: 'owned',
      },
      roQuery: vi.fn().mockImplementation(async (cypher: string) => {
        if (cypher.includes('codegraph.embeddingProfile')) {
          return { data: [{ value: JSON.stringify(storedProfile) }], metadata: [] };
        }
        if (cypher.includes('Project')) {
          return { data: [{ count: 0 }], metadata: [] };
        }
        return { data: [], metadata: [] };
      }),
    } as unknown as GraphClient;

    const status = await getSetupStatus({
      client,
      embeddedSupported: true,
      embeddingProfile: requestedProfile,
      modelLoad: {
        state: 'ready',
        model: requestedProfile.model,
        cached: true,
      },
      indexProgress: null,
      embeddingPass: { running: false, scope: null, startedAt: null },
    });

    expect(status).toEqual({
      storage: {
        driver: 'falkordblite',
        dataPath: '/private/tmp/codegraph-setup-contract',
        ownerState: 'owned',
        embeddedSupported: true,
        externalGuidance: null,
        error: null,
      },
      embedding: {
        profile: requestedProfile,
        keyPresent: false,
        localModelCached: true,
        modelLoad: {
          state: 'ready',
          model: requestedProfile.model,
          cached: true,
        },
        migration: {
          required: true,
          code: 'EMBEDDING_PROFILE_MISMATCH',
          storedProfile,
          requestedProfile,
          remedy: 'Run an explicit re-embed migration or a full reindex before using the requested embedding profile.',
          allowedActions: ['re-embed', 'full-reindex'],
        },
      },
      projects: { configured: false, count: 0 },
      index: {
        state: 'migration-required',
        progress: null,
        embeddingPass: { running: false, scope: null, startedAt: null },
      },
    });
  });

  it('migrates the persisted profile before re-embedding and supports safe re-runs', async () => {
    const requestedProfile = {
      provider: 'local',
      model: 'nomic-ai/nomic-embed-text-v1.5',
      dimension: 768,
    } as const;
    const events: string[] = [];
    const client = {
      ensureIndexes: vi.fn(async () => { events.push('indexes'); }),
    } as unknown as GraphClient;
    const schedulePass = vi.fn(async () => {
      events.push('embeddings');
      return { embedded: 2, skipped: 0, errors: 0, durationMs: 12, byType: { Function: 2 } };
    });

    const first = await getSetupStatus.migrateEmbeddingProfile({
      client,
      embeddingProfile: requestedProfile,
      schedulePass,
    });
    const second = await getSetupStatus.migrateEmbeddingProfile({
      client,
      embeddingProfile: requestedProfile,
      schedulePass,
    });

    expect(events).toEqual(['indexes', 'embeddings', 'indexes', 'embeddings']);
    expect(client.ensureIndexes).toHaveBeenCalledWith({
      embeddingProfile: requestedProfile,
      allowEmbeddingMigration: true,
    });
    expect(first).toMatchObject({ embedded: 2, errors: 0, profile: requestedProfile });
    expect(second).toMatchObject({ embedded: 2, errors: 0, profile: requestedProfile });
  });

  it('rejects a migration whose re-embedding pass reports write errors', async () => {
    const requestedProfile = {
      provider: 'local',
      model: 'nomic-ai/nomic-embed-text-v1.5',
      dimension: 768,
    } as const;
    const client = { ensureIndexes: vi.fn() } as unknown as GraphClient;

    await expect(getSetupStatus.migrateEmbeddingProfile({
      client,
      embeddingProfile: requestedProfile,
      schedulePass: vi.fn(async () => ({
        embedded: 0,
        skipped: 0,
        errors: 2,
        durationMs: 12,
        byType: {},
      })),
    })).rejects.toThrow('Embedding migration failed with 2 write errors');
  });
});
