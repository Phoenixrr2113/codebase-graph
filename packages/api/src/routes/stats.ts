import { Hono } from 'hono';
import { codeGraphService, knowledgeService, getGraphClient, getSetupStatus, indexProject } from '@codegraph/core';
import type { GraphClient } from '@codegraph/graph';
import { safeErrorMessage } from '../safe-error.js';
import { normalizeSetupStatus, readBlockedSetupStatus } from '../storage-state.js';

export const statsRoutes = new Hono();

statsRoutes.get('/api/setup/status', async (c) => {
  try {
    return c.json(normalizeSetupStatus(await getSetupStatus()));
  } catch (error) {
    return c.json({ error: safeErrorMessage('GET /api/setup/status', error, 'Failed to fetch setup status.') }, 500);
  }
});

type EmbeddingScope =
  | { type: 'global' }
  | { type: 'project'; projectId: string; rootPath: string };

interface EmbeddingPassState {
  running: boolean;
  scope: EmbeddingScope | null;
  startedAt: string | null;
}

interface EmbeddingGenerateResult {
  embedded: number;
  skipped: number;
  errors: number;
  durationMs: number;
  byType: Record<string, number>;
}

interface EmbeddingMigrationResult extends EmbeddingGenerateResult {
  profile: {
    provider: 'local' | 'voyage' | 'openrouter' | 'none';
    model: string | null;
    dimension: number;
  };
}

const embeddingCoordinator = indexProject as typeof indexProject & {
  getEmbeddingPassState(projectId?: string): EmbeddingPassState;
  scheduleEmbeddingPass(options: {
    client: GraphClient;
    force: boolean;
    projectId?: string;
    rootPath?: string;
  }): Promise<EmbeddingGenerateResult>;
};

const setupCoordinator = getSetupStatus as typeof getSetupStatus & {
  migrateEmbeddingProfile(options: { client: GraphClient }): Promise<EmbeddingMigrationResult>;
};

function normalizeProjectRoot(rootPath: string): string {
  return rootPath.replace(/\/+$/, '') || '/';
}

async function resolveEmbeddingScope(projectId: string | undefined): Promise<EmbeddingScope | null> {
  if (projectId === undefined) return { type: 'global' };
  const rootPath = await codeGraphService.resolveProjectRootPath(projectId);
  return rootPath === undefined
    ? null
    : { type: 'project', projectId, rootPath: normalizeProjectRoot(rootPath) };
}

/** GET /api/projects — list indexed projects */
statsRoutes.get('/api/projects', async (c) => {
  try {
    const client = await getGraphClient();
    // The node records lastParsed and createdAt. There is no indexedAt property,
    // so asking for one returned null for every project.
    const result = await client.roQuery<{
      id: string;
      name: string;
      rootPath: string | null;
      lastParsed: string | null;
      createdAt: string | null;
      fileCount: number | null;
    }>(
      `MATCH (p:Project)
       RETURN p.id AS id, p.name AS name, p.rootPath AS rootPath,
              p.lastParsed AS lastParsed, p.createdAt AS createdAt, p.fileCount AS fileCount
       ORDER BY p.name`,
    );
    const projects = result.data.map((project) => ({
      id: project.id,
      name: project.name,
      rootPath: project.rootPath,
      // A project parsed once has only createdAt, and that is still when it was indexed.
      indexedAt: project.lastParsed ?? project.createdAt,
      fileCount: project.fileCount ?? 0,
    }));
    return c.json({ projects });
  } catch (error) {
    const setup = await readBlockedSetupStatus();
    if (setup !== null) return c.json({ projects: [], storage: setup.storage });
    return c.json(
      { projects: [], error: safeErrorMessage('GET /api/projects', error, 'Failed to list projects.') },
      500,
    );
  }
});

/** GET /api/stats — code graph statistics */
statsRoutes.get('/api/stats', async (c) => {
  try {
    const stats = await codeGraphService.getGraphStats();
    return c.json(stats);
  } catch (error) {
    return c.json({ error: safeErrorMessage('GET /api/stats', error, 'Failed to fetch stats.') }, 500);
  }
});

/** GET /api/knowledge/stats — knowledge graph statistics */
statsRoutes.get('/api/knowledge/stats', async (c) => {
  try {
    const stats = await knowledgeService.getKnowledgeStats();
    return c.json(stats);
  } catch (error) {
    return c.json({ error: safeErrorMessage('GET /api/knowledge/stats', error, 'Failed to fetch knowledge stats.') }, 500);
  }
});

/** GET /api/embeddings/status — embedding coverage per label */
statsRoutes.get('/api/embeddings/status', async (c) => {
  try {
    const projectId = c.req.query('projectId') || undefined;
    const scope = await resolveEmbeddingScope(projectId);
    if (scope === null) return c.json({ error: 'Project not found.' }, 404);

    const client = await getGraphClient();
    const projectFilter = scope.type === 'project'
      ? 'AND (n.filePath = $projectPath OR n.filePath STARTS WITH $projectPathPrefix)'
      : '';
    const params = scope.type === 'project'
      ? {
          projectPath: scope.rootPath,
          projectPathPrefix: scope.rootPath === '/' ? '/' : `${scope.rootPath}/`,
        }
      : {};

    // Get counts of nodes with and without embeddings per label
    const result = await client.roQuery<{
      label: string;
      total: number;
      withEmbedding: number;
    }>(
      `MATCH (n)
       WHERE labels(n)[0] IS NOT NULL
         ${projectFilter}
       WITH labels(n)[0] AS label, n
       RETURN label,
              count(n) AS total,
              sum(CASE WHEN n.embedding IS NOT NULL THEN 1 ELSE 0 END) AS withEmbedding
       ORDER BY total DESC`,
      { params },
    );

    const labels = result.data.map((row) => ({
      label: row.label,
      total: row.total,
      withEmbedding: row.withEmbedding,
      coverage: row.total > 0 ? Math.round((row.withEmbedding / row.total) * 100) : 0,
    }));

    const setup = await getSetupStatus();
    return c.json({
      scope,
      embeddingPass: embeddingCoordinator.getEmbeddingPassState(projectId),
      embedding: setup.embedding,
      labels,
    });
  } catch (error) {
    const setup = await readBlockedSetupStatus();
    if (setup !== null) {
      const projectId = c.req.query('projectId') || undefined;
      return c.json({
        scope: projectId === undefined
          ? { type: 'global' as const }
          : { type: 'project' as const, projectId, rootPath: null },
        embeddingPass: embeddingCoordinator.getEmbeddingPassState(projectId),
        embedding: setup.embedding,
        labels: [],
        storage: setup.storage,
      });
    }
    return c.json({ error: safeErrorMessage('GET /api/embeddings/status', error, 'Failed to fetch embedding status.') }, 500);
  }
});

/** POST /api/embeddings/generate — generate embeddings for all nodes */
statsRoutes.post('/api/embeddings/generate', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const values = body as Record<string, unknown>;
    const rawProjectId = values.projectId;
    if (
      rawProjectId !== undefined &&
      (typeof rawProjectId !== 'string' || rawProjectId.trim().length === 0)
    ) {
      return c.json({ error: 'projectId must be a non-empty string.' }, 400);
    }
    const projectId = typeof rawProjectId === 'string' ? rawProjectId : undefined;
    const scope = await resolveEmbeddingScope(projectId);
    if (scope === null) return c.json({ error: 'Project not found.' }, 404);
    const force = values.force === true;
    const client = await getGraphClient();

    if (force && (await getSetupStatus()).embedding.migration !== null) {
      const result = await setupCoordinator.migrateEmbeddingProfile({ client });
      return c.json({
        scope,
        ...result,
        message: `Embedded ${result.embedded} nodes in ${(result.durationMs / 1000).toFixed(1)}s (${result.skipped} skipped, ${result.errors} errors)`,
      });
    }

    const result = await embeddingCoordinator.scheduleEmbeddingPass({
      client,
      force,
      ...(scope.type === 'project'
        ? { projectId: scope.projectId, rootPath: scope.rootPath }
        : {}),
    });

    return c.json({
      scope,
      ...result,
      message: `Embedded ${result.embedded} nodes in ${(result.durationMs / 1000).toFixed(1)}s (${result.skipped} skipped, ${result.errors} errors)`,
    });
  } catch (error) {
    // There used to be a branch here that special-cased any error whose
    // message contained "not configured" or "not available", on the theory
    // that embedAllNodes() throws a controlled, known string for that case
    // and it was safe to echo verbatim. It does not: the availability check
    // inside embedAllNodes() (packages/core/src/embed-nodes.ts) logs a
    // warning and returns a benign zero-result instead of throwing, and
    // every per-batch and per-node failure inside it is caught internally
    // and folded into the returned counters. Nothing embedAllNodes() itself
    // does can reach this catch block. The only way to land here is an
    // exception from setup code outside its own try blocks (getGraphClient()
    // failing to connect, for instance), which is exactly the raw,
    // unstructured error text safeErrorMessage exists to keep out of a
    // response, not a string this route authored. A substring match against
    // that text was never a reliable way to tell "embeddings are not
    // configured" from "something unrelated broke", so it is removed rather
    // than kept with a corrected comment: keeping it, accurately described
    // or not, would still forward whatever an unrelated exception says,
    // unsanitized, whenever it happens to contain those words.
    return c.json({ error: safeErrorMessage('POST /api/embeddings/generate', error, 'Failed to generate embeddings.') }, 500);
  }
});

/** POST /api/embeddings/migrate: rebuild vector indexes for the resolved profile and re-embed. */
statsRoutes.post('/api/embeddings/migrate', async (c) => {
  try {
    const client = await getGraphClient();
    const result = await setupCoordinator.migrateEmbeddingProfile({ client });
    return c.json({
      ...result,
      message: `Migrated embedding profile and embedded ${result.embedded} nodes in ${(result.durationMs / 1000).toFixed(1)}s`,
    });
  } catch (error) {
    return c.json({
      error: safeErrorMessage(
        'POST /api/embeddings/migrate',
        error,
        'Failed to migrate the embedding profile.',
      ),
    }, 500);
  }
});
