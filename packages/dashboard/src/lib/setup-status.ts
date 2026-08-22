export type EmbeddingProvider = 'local' | 'voyage' | 'openrouter' | 'none'
export type SetupIndexPhase =
  | 'storage'
  | 'discovering'
  | 'parsing'
  | 'writing'
  | 'embedding'
  | 'complete'
  | 'failed'

export interface EmbeddingProfile {
  provider: EmbeddingProvider
  model: string | null
  dimension: number
}

export interface SetupStatus {
  storage: {
    driver: 'falkordb' | 'falkordblite'
    dataPath: string | null
    ownerState: 'owned' | 'attached' | 'starting' | 'blocked'
    embeddedSupported: boolean
    externalGuidance: string | null
    error: string | null
  }
  embedding: {
    profile: EmbeddingProfile
    keyPresent: boolean
    localModelCached: boolean
    modelLoad: {
      state: 'not-started' | 'downloading' | 'loading' | 'ready' | 'failed'
      model: string
      cached: boolean
      loadedBytes?: number
      totalBytes?: number
      percent?: number
      error?: string
    } | null
    migration: {
      required: true
      code: 'EMBEDDING_PROFILE_MISMATCH'
      storedProfile: EmbeddingProfile
      requestedProfile: EmbeddingProfile
      remedy: string
      allowedActions: ['re-embed', 'full-reindex']
    } | null
  }
  projects: {
    configured: boolean
    count: number
  }
  index: {
    state: 'not-configured' | 'idle' | 'indexing' | 'embedding' | 'migration-required' | 'failed'
    progress: {
      id: string
      phase: SetupIndexPhase
      processed?: number
      total?: number
      message?: string
      startedAt: string
      completedAt?: string
    } | null
    embeddingPass: {
      running: boolean
      scope: { type: 'global' } | { type: 'project'; projectId: string; rootPath: string } | null
      startedAt: string | null
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0
}

function isOptionalNonNegativeNumber(value: unknown): value is number | undefined {
  return value === undefined || isNonNegativeNumber(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T)
}

const providers = ['local', 'voyage', 'openrouter', 'none'] as const

function parseProfile(value: unknown): EmbeddingProfile {
  if (
    !isRecord(value)
    || !isOneOf(value.provider, providers)
    || !isNullableString(value.model)
    || !Number.isInteger(value.dimension)
    || !isNonNegativeNumber(value.dimension)
  ) {
    throw new Error('Setup status returned an invalid embedding profile')
  }
  return { provider: value.provider, model: value.model, dimension: value.dimension }
}

function parseModelLoad(value: unknown): SetupStatus['embedding']['modelLoad'] {
  if (value === null) return null
  if (
    !isRecord(value)
    || !isOneOf(value.state, ['not-started', 'downloading', 'loading', 'ready', 'failed'] as const)
    || typeof value.model !== 'string'
    || typeof value.cached !== 'boolean'
    || !isOptionalNonNegativeNumber(value.loadedBytes)
    || !isOptionalNonNegativeNumber(value.totalBytes)
    || !isOptionalNonNegativeNumber(value.percent)
    || (typeof value.percent === 'number' && value.percent > 100)
    || (value.error !== undefined && typeof value.error !== 'string')
  ) {
    throw new Error('Setup status returned invalid model progress')
  }
  return {
    state: value.state,
    model: value.model,
    cached: value.cached,
    ...(value.loadedBytes === undefined ? {} : { loadedBytes: value.loadedBytes }),
    ...(value.totalBytes === undefined ? {} : { totalBytes: value.totalBytes }),
    ...(value.percent === undefined ? {} : { percent: value.percent }),
    ...(value.error === undefined ? {} : { error: value.error }),
  }
}

function parseMigration(value: unknown): SetupStatus['embedding']['migration'] {
  if (value === null) return null
  if (
    !isRecord(value)
    || value.required !== true
    || value.code !== 'EMBEDDING_PROFILE_MISMATCH'
    || typeof value.remedy !== 'string'
    || !Array.isArray(value.allowedActions)
    || value.allowedActions.length !== 2
    || value.allowedActions[0] !== 're-embed'
    || value.allowedActions[1] !== 'full-reindex'
  ) {
    throw new Error('Setup status returned an invalid migration')
  }
  return {
    required: true,
    code: 'EMBEDDING_PROFILE_MISMATCH',
    storedProfile: parseProfile(value.storedProfile),
    requestedProfile: parseProfile(value.requestedProfile),
    remedy: value.remedy,
    allowedActions: ['re-embed', 'full-reindex'],
  }
}

function parseProgress(value: unknown): SetupStatus['index']['progress'] {
  if (value === null) return null
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || !isOneOf(value.phase, ['storage', 'discovering', 'parsing', 'writing', 'embedding', 'complete', 'failed'] as const)
    || !isOptionalNonNegativeNumber(value.processed)
    || !isOptionalNonNegativeNumber(value.total)
    || (value.message !== undefined && typeof value.message !== 'string')
    || typeof value.startedAt !== 'string'
    || (value.completedAt !== undefined && typeof value.completedAt !== 'string')
  ) {
    throw new Error('Setup status returned invalid index progress')
  }
  return {
    id: value.id,
    phase: value.phase,
    startedAt: value.startedAt,
    ...(value.processed === undefined ? {} : { processed: value.processed }),
    ...(value.total === undefined ? {} : { total: value.total }),
    ...(value.message === undefined ? {} : { message: value.message }),
    ...(value.completedAt === undefined ? {} : { completedAt: value.completedAt }),
  }
}

function parseEmbeddingScope(value: unknown): SetupStatus['index']['embeddingPass']['scope'] {
  if (value === null) return null
  if (!isRecord(value) || !isOneOf(value.type, ['global', 'project'] as const)) {
    throw new Error('Setup status returned an invalid embedding scope')
  }
  if (value.type === 'global') return { type: 'global' }
  if (typeof value.projectId !== 'string' || typeof value.rootPath !== 'string') {
    throw new Error('Setup status returned an invalid embedding scope')
  }
  return { type: 'project', projectId: value.projectId, rootPath: value.rootPath }
}

export function parseSetupStatus(value: unknown): SetupStatus {
  if (!isRecord(value) || !isRecord(value.storage) || !isRecord(value.embedding) || !isRecord(value.projects) || !isRecord(value.index)) {
    throw new Error('Setup status returned an invalid response')
  }
  const { storage, embedding, projects, index } = value
  if (
    !isOneOf(storage.driver, ['falkordb', 'falkordblite'] as const)
    || !isNullableString(storage.dataPath)
    || !isOneOf(storage.ownerState, ['owned', 'attached', 'starting', 'blocked'] as const)
    || typeof storage.embeddedSupported !== 'boolean'
    || !isNullableString(storage.externalGuidance)
    || !isNullableString(storage.error)
    || typeof embedding.keyPresent !== 'boolean'
    || typeof embedding.localModelCached !== 'boolean'
    || typeof projects.configured !== 'boolean'
    || !Number.isInteger(projects.count)
    || !isNonNegativeNumber(projects.count)
    || !isOneOf(index.state, ['not-configured', 'idle', 'indexing', 'embedding', 'migration-required', 'failed'] as const)
    || !isRecord(index.embeddingPass)
    || typeof index.embeddingPass.running !== 'boolean'
    || !isNullableString(index.embeddingPass.startedAt)
  ) {
    throw new Error('Setup status returned an invalid response')
  }

  return {
    storage: {
      driver: storage.driver,
      dataPath: storage.dataPath,
      ownerState: storage.ownerState,
      embeddedSupported: storage.embeddedSupported,
      externalGuidance: storage.externalGuidance,
      error: storage.error,
    },
    embedding: {
      profile: parseProfile(embedding.profile),
      keyPresent: embedding.keyPresent,
      localModelCached: embedding.localModelCached,
      modelLoad: parseModelLoad(embedding.modelLoad),
      migration: parseMigration(embedding.migration),
    },
    projects: { configured: projects.configured, count: projects.count },
    index: {
      state: index.state,
      progress: parseProgress(index.progress),
      embeddingPass: {
        running: index.embeddingPass.running,
        scope: parseEmbeddingScope(index.embeddingPass.scope),
        startedAt: index.embeddingPass.startedAt,
      },
    },
  }
}

export async function loadSetupStatus(apiUrl: string, signal?: AbortSignal): Promise<SetupStatus> {
  const response = await fetch(`${apiUrl}/api/setup/status`, { signal })
  if (!response.ok) throw new Error(`Setup status unavailable (HTTP ${response.status})`)
  return parseSetupStatus(await response.json())
}

export function setupNeedsPolling(status: SetupStatus): boolean {
  return status.index.state === 'indexing'
    || status.index.state === 'embedding'
    || status.index.embeddingPass.running
    || status.embedding.modelLoad?.state === 'downloading'
    || status.embedding.modelLoad?.state === 'loading'
}
