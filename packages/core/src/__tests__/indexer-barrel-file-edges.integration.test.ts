import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, resolveEmbeddedBinaryPaths, type GraphClient } from '@codegraph/graph';
import { indexProject } from '../indexer';

const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

describeIfAvailable('indexProject File graph barrel hops', () => {
  let fixtureDir: string;
  let dataDir: string;
  let client: GraphClient;

  beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), 'cg-barrel-file-fixture-'));
    dataDir = await mkdtemp(join(tmpdir(), 'cg-barrel-file-db-'));
    await Promise.all([
      writeFile(join(fixtureDir, 'leaf.ts'), 'export function leaf(): number { return 1 }\n'),
      writeFile(join(fixtureDir, 'index.ts'), "export { leaf } from './leaf'\n"),
      writeFile(join(fixtureDir, 'chain.ts'), "export { leaf } from './index'\n"),
      writeFile(join(fixtureDir, 'consumer.ts'), "import { leaf } from './chain'\nexport const value = leaf()\n"),
      writeFile(join(fixtureDir, 'package.json'), '{"name":"barrel-file-fixture","type":"module"}\n'),
    ]);
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'barrel-file-edges',
    } as never);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
    if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it('stores consumer to chain, chain to index, and index to leaf IMPORTS hops', async () => {
    const indexed = await indexProject(fixtureDir, {
      client,
      embeddings: false,
      gitSync: false,
      force: true,
    });
    expect(indexed.success).toBe(true);

    const result = await client.roQuery<{ source: string; target: string }>(`
      MATCH (source:File)-[:IMPORTS]->(target:File)
      RETURN source.filePath AS source, target.filePath AS target
    `);
    const pairs = new Set(result.data.map((row) => `${row.source}->${row.target}`));
    expect(pairs).toEqual(new Set([
      `${join(fixtureDir, 'consumer.ts')}->${join(fixtureDir, 'chain.ts')}`,
      `${join(fixtureDir, 'chain.ts')}->${join(fixtureDir, 'index.ts')}`,
      `${join(fixtureDir, 'index.ts')}->${join(fixtureDir, 'leaf.ts')}`,
    ]));
  }, 30_000);
});
