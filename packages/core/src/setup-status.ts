import { resolve } from 'node:path';
import {
  supportsEmbeddedPlatform,
  EMBEDDING_MIGRATION_REMEDY,
  type EmbeddingIndexProfile,
  type GraphClient,
} from '@codegraph/graph';
import {
  getEmbeddingProfile,
  getLocalEmbeddingModelState,
  type EmbeddingLoadProgress,
  type EmbeddingProfile,
} from '@codegraph/plugin-nlp';
import {
  getEmbeddingPassState,
  scheduleEmbeddingPass,
  type EmbeddingPassState,
} from './embed-pass';
import type { EmbedNodesResult } from './embed-nodes';
import { getGraphClient, getGraphClientRuntimeState } from './graphClient';
import { getIndexProgressState, type IndexProgressState } from './indexer';

export type SetupStorageOwnerState = 'owned' | 'attached' | 'starting' | 'blocked';

export interface SetupStatus {
  storage: {
    driver: 'falkordb' | 'falkordblite';
    dataPath: string | null;
    ownerState: SetupStorageOwnerState;
    embeddedSupported: boolean;
    externalGuidance: string | null;
    error: string | null;
  };
  embedding: {
    profile: EmbeddingProfile;
    keyPresent: boolean;
    localModelCached: boolean;
    modelLoad: EmbeddingLoadProgress | null;
    migration: {
      required: true;
      code: 'EMBEDDING_PROFILE_MISMATCH';
      storedProfile: EmbeddingIndexProfile;
      requestedProfile: EmbeddingIndexProfile;
      remedy: string;
      allowedActions: ['re-embed', 'full-reindex'];
    } | null;
  };
  projects: {
    configured: boolean;
    count: number;
  };
  index: {
    state: 'not-configured' | 'idle' | 'indexing' | 'embedding' | 'migration-required' | 'failed';
    progress: IndexProgressState | null;
    embeddingPass: EmbeddingPassState;
  };
}

export interface SetupStatusDependencies {
  client?: GraphClient;
  embeddedSupported?: boolean;
  embeddingProfile?: EmbeddingProfile;
  modelLoad?: EmbeddingLoadProgress | null;
  indexProgress?: IndexProgressState | null;
  embeddingPass?: EmbeddingPassState;
}

export interface EmbeddingMigrationResult extends EmbedNodesResult {
  profile: EmbeddingProfile;
}

export interface EmbeddingMigrationDependencies {
  client?: GraphClient;
  embeddingProfile?: EmbeddingProfile;
  schedulePass?: typeof scheduleEmbeddingPass;
}

const EXTERNAL_FALKORDB_GUIDANCE =
  'Embedded FalkorDBLite is unavailable on this platform. Set CODEGRAPH_DRIVER=falkordb and FALKORDB_URL, or configure FALKORDB_HOST and FALKORDB_PORT.';

function profilesMatch(left: EmbeddingIndexProfile, right: EmbeddingIndexProfile): boolean {
  return left.provider === right.provider
    && left.model === right.model
    && left.dimension === right.dimension;
}

function isEmbeddingIndexProfile(value: unknown): value is EmbeddingIndexProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Record<string, unknown>;
  return ['local', 'voyage', 'openrouter', 'none'].includes(String(profile['provider']))
    && (typeof profile['model'] === 'string' || profile['model'] === null)
    && typeof profile['dimension'] === 'number'
    && Number.isInteger(profile['dimension'])
    && profile['dimension'] >= 0;
}

async function readStoredProfile(client: GraphClient): Promise<EmbeddingIndexProfile | null> {
  const result = await client.roQuery<{ value: string }>(
    `MATCH (m:Metadata {key: 'codegraph.embeddingProfile'}) RETURN m.value AS value`,
  );
  const raw = result.data[0]?.value;
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isEmbeddingIndexProfile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hasProviderKey(profile: EmbeddingProfile): boolean {
  if (profile.provider === 'voyage') return Boolean(process.env['VOYAGE_API_KEY']);
  if (profile.provider === 'openrouter') return Boolean(process.env['OPENROUTER_API_KEY']);
  return false;
}

function requestedDriver(embeddedSupported: boolean): 'falkordb' | 'falkordblite' {
  const configured = process.env['CODEGRAPH_DRIVER'];
  if (configured === 'falkordb' || configured === 'falkordblite') return configured;
  if (process.env['FALKORDB_URL'] || process.env['FALKORDB_HOST']) return 'falkordb';
  return embeddedSupported ? 'falkordblite' : 'falkordb';
}

function indexState(
  configured: boolean,
  migrationRequired: boolean,
  progress: IndexProgressState | null,
  embeddingPass: EmbeddingPassState,
): SetupStatus['index']['state'] {
  if (migrationRequired) return 'migration-required';
  if (progress?.phase === 'failed') return 'failed';
  if (progress?.phase === 'embedding' || embeddingPass.running) return 'embedding';
  if (progress && progress.phase !== 'complete') return 'indexing';
  return configured ? 'idle' : 'not-configured';
}

export async function getSetupStatus(
  dependencies: SetupStatusDependencies = {},
): Promise<SetupStatus> {
  const embeddedSupported = dependencies.embeddedSupported ?? supportsEmbeddedPlatform();
  const profile = dependencies.embeddingProfile ?? getEmbeddingProfile();
  const modelLoad = dependencies.modelLoad !== undefined
    ? dependencies.modelLoad
    : profile.provider === 'local'
      ? getLocalEmbeddingModelState(profile.model ?? undefined)
      : null;
  const progress = dependencies.indexProgress !== undefined
    ? dependencies.indexProgress
    : getIndexProgressState();
  const embeddingPass = dependencies.embeddingPass ?? getEmbeddingPassState();

  let client = dependencies.client;
  let ownerState: SetupStorageOwnerState = 'starting';
  let storageError: string | null = null;

  if (!client) {
    const runtime = getGraphClientRuntimeState();
    if (runtime.state === 'ready') {
      client = runtime.client;
    } else if (runtime.state === 'blocked') {
      ownerState = 'blocked';
      storageError = runtime.error;
    } else if (runtime.state === 'idle') {
      try {
        client = await getGraphClient();
      } catch (error) {
        ownerState = 'blocked';
        storageError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  const driver = client?.storage.driver ?? requestedDriver(embeddedSupported);
  const dataPath = client?.storage.dataPath
    ?? (driver === 'falkordblite'
      ? resolve(process.env['CODEGRAPH_DB_PATH'] ?? '.codegraph/falkordb')
      : null);
  if (client) ownerState = client.storage.ownerState;

  let projectCount = 0;
  let storedProfile: EmbeddingIndexProfile | null = null;
  if (client) {
    const [projectResult, persistedProfile] = await Promise.all([
      client.roQuery<{ count: number }>('MATCH (p:Project) RETURN count(p) AS count'),
      readStoredProfile(client),
    ]);
    projectCount = projectResult.data[0]?.count ?? 0;
    storedProfile = persistedProfile;
  }

  const requestedProfile: EmbeddingIndexProfile = profile;
  const migrationRequired = storedProfile !== null && !profilesMatch(storedProfile, requestedProfile);
  const migration = migrationRequired && storedProfile
    ? {
        required: true as const,
        code: 'EMBEDDING_PROFILE_MISMATCH' as const,
        storedProfile,
        requestedProfile,
        remedy: EMBEDDING_MIGRATION_REMEDY,
        allowedActions: ['re-embed', 'full-reindex'] as ['re-embed', 'full-reindex'],
      }
    : null;
  const configured = projectCount > 0;

  return {
    storage: {
      driver,
      dataPath,
      ownerState,
      embeddedSupported,
      externalGuidance: embeddedSupported ? null : EXTERNAL_FALKORDB_GUIDANCE,
      error: storageError,
    },
    embedding: {
      profile,
      keyPresent: hasProviderKey(profile),
      localModelCached: profile.provider === 'local' ? modelLoad?.cached ?? false : false,
      modelLoad,
      migration,
    },
    projects: { configured, count: projectCount },
    index: {
      state: indexState(configured, migrationRequired, progress, embeddingPass),
      progress,
      embeddingPass,
    },
  };
}

const activeMigrations = new WeakMap<GraphClient, Promise<EmbeddingMigrationResult>>();

export namespace getSetupStatus {
  export function migrateEmbeddingProfile(
    dependencies: EmbeddingMigrationDependencies = {},
  ): Promise<EmbeddingMigrationResult> {
    const run = async (): Promise<EmbeddingMigrationResult> => {
      const client = dependencies.client ?? await getGraphClient();
      const existing = activeMigrations.get(client);
      if (existing) return existing;

      const profile = dependencies.embeddingProfile ?? getEmbeddingProfile();
      const schedulePass = dependencies.schedulePass ?? scheduleEmbeddingPass;
      const migration = (async (): Promise<EmbeddingMigrationResult> => {
        await client.ensureIndexes({
          embeddingProfile: profile,
          allowEmbeddingMigration: true,
        });
        const result = await schedulePass({ client, force: false });
        if (result.errors > 0) {
          throw new Error(`Embedding migration failed with ${result.errors} write errors`);
        }
        return { ...result, profile };
      })().finally(() => {
        activeMigrations.delete(client);
      });

      activeMigrations.set(client, migration);
      return migration;
    };

    return run();
  }
}
