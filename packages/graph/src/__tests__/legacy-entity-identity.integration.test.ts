import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type GraphClient } from '../client';
import { createKnowledgeOperations, type KnowledgeOperations } from '../knowledge-operations';
import { createQueries, type GraphQueries } from '../queries';
import { resolveEmbeddedBinaryPaths } from '../drivers/falkordblite';

const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

describeIfAvailable('legacy Entity identity compatibility', () => {
  let client: GraphClient;
  let knowledge: KnowledgeOperations;
  let queries: GraphQueries;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'cg-legacy-entity-'));
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'legacy_entity_identity',
    } as never);
    knowledge = createKnowledgeOperations(client);
    queries = createQueries(client);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it('derives the deterministic id when a full-graph Entity row has no persisted id', async () => {
    await client.query(
      'CREATE (:Entity {text: $text, type: $type})',
      { params: { text: 'Legacy retry policy', type: 'Decision' } },
    );

    const graph = await queries.getFullGraph(10);

    expect(graph.nodes).toContainEqual(expect.objectContaining({
      id: 'Entity:Decision:Legacy retry policy',
      label: 'Entity',
      displayName: 'Legacy retry policy',
    }));
  });

  it('backfills that deterministic id when an upsert matches an idless legacy Entity', async () => {
    await client.query(
      'CREATE (:Entity {text: $text, type: $type})',
      { params: { text: 'Legacy deployment rule', type: 'Decision' } },
    );

    const returnedId = await knowledge.createEntity({
      text: 'Legacy deployment rule',
      type: 'Decision',
    });
    const persisted = await client.roQuery<{ id: string }>(
      'MATCH (entity:Entity {text: $text, type: $type}) RETURN entity.id AS id',
      { params: { text: 'Legacy deployment rule', type: 'Decision' } },
    );

    expect(returnedId).toBe('Entity:Decision:Legacy deployment rule');
    expect(persisted.data).toEqual([{ id: 'Entity:Decision:Legacy deployment rule' }]);
  });

  it('preserves the existing deterministic fallback for a legacy File row', async () => {
    await client.query(
      'CREATE (:File {name: $name, filePath: $filePath})',
      { params: { name: 'legacy.ts', filePath: '/legacy/legacy.ts' } },
    );

    const graph = await queries.getFullGraph(10);

    expect(graph.nodes).toContainEqual(expect.objectContaining({
      id: 'File:/legacy/legacy.ts',
      label: 'File',
      displayName: 'legacy.ts',
    }));
  });

  it('still rejects an idless source-symbol row', async () => {
    await client.query(
      'CREATE (:Function {name: $name, filePath: $filePath, startLine: 1})',
      { params: { name: 'legacySource', filePath: '/legacy/source.ts' } },
    );

    await expect(queries.getFullGraph(10)).rejects.toThrow('Graph node is missing a persisted id');
  });
});
