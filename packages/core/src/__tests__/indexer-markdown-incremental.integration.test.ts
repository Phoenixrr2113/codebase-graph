import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, resolveEmbeddedBinaryPaths, type GraphClient } from '@codegraph/graph';
import { indexProject } from '../indexer';

const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

describeIfAvailable('indexProject: incremental Markdown content refresh', () => {
  let client: GraphClient;
  let dataDir: string;
  let projectRoot: string;
  let markdownPath: string;
  let previousEmbeddingProvider: string | undefined;

  beforeAll(async () => {
    previousEmbeddingProvider = process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = 'none';

    dataDir = await mkdtemp(join(tmpdir(), 'cg-md-db-'));
    projectRoot = await mkdtemp(join(tmpdir(), 'cg-md-proj-'));
    markdownPath = join(projectRoot, 'doc.md');
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'markdown_incremental_regression',
    } as never);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
    if (previousEmbeddingProvider === undefined) {
      delete process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    } else {
      process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = previousEmbeddingProvider;
    }
  });

  it('removes stale hierarchy and section content before re-upserting changed Markdown', async () => {
    await writeFile(markdownPath, '# Root\n\n## Child\n', 'utf8');
    const first = await indexProject(projectRoot, {
      client,
      embeddings: false,
      gitSync: false,
    });
    expect(first.success).toBe(true);

    const before = await client.roQuery<{ parent: string; child: string }>(
      `MATCH (p:Section)-[:PARENT_SECTION]->(c:Section)
       RETURN p.heading AS parent, c.heading AS child`,
    );
    expect(before.data).toEqual([{ parent: 'Root', child: 'Child' }]);

    await writeFile(markdownPath, '# New Root\n\n\n\n# New Second Root\n', 'utf8');
    const second = await indexProject(projectRoot, {
      client,
      embeddings: false,
      gitSync: false,
    });
    expect(second.success).toBe(true);

    const parentEdges = await client.roQuery<{ count: number }>(
      `MATCH (:Section)-[r:PARENT_SECTION]->(:Section)
       WHERE startNode(r).filePath = $path
       RETURN count(r) AS count`,
      { params: { path: markdownPath } },
    );
    expect(parentEdges.data[0]?.count).toBe(0);

    const staleChild = await client.roQuery<{ count: number }>(
      `MATCH (s:Section {filePath: $path, heading: 'Child'}) RETURN count(s) AS count`,
      { params: { path: markdownPath } },
    );
    expect(staleChild.data[0]?.count).toBe(0);
  });
});
