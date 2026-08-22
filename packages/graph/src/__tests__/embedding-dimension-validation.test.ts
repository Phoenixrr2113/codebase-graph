import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { createClient, createOperations, resolveEmbeddedBinaryPaths, type GraphClient } from '../index';

const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

describeIfAvailable('persisted embedding index dimension validation', () => {
  let client: GraphClient;
  let dataPath: string;
  const id = `sym:v1:${'1'.repeat(64)}`;

  beforeAll(async () => {
    dataPath = await mkdtemp('/tmp/cged-');
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataPath,
      graphName: `embedding_dimension_${Date.now()}`,
    });
    await client.ensureIndexes({
      embeddingProfile: { provider: 'voyage', model: 'voyage-code-3', dimension: 1024 },
    });
    await client.query(
      'CREATE (:Function {id: $id, name: $name, filePath: $filePath, startLine: 1, endLine: 3})',
      { params: { id, name: 'wrongDimension', filePath: '/tmp/wrong.ts' } },
    );
  }, 30_000);

  afterAll(async () => {
    if (client) await client.close();
    if (dataPath) await rm(dataPath, { recursive: true, force: true });
  }, 15_000);

  it('rejects the reviewer 768-into-1024 single write reproduction', async () => {
    const ops = createOperations(client);

    await expect(
      ops.updateEmbedding('Function', { id }, Array.from({ length: 768 }, () => 0.25), 'wrong-dimension'),
    ).rejects.toThrow('Embedding vector length 768 does not match persisted index dimension 1024');
  });

  it('rejects a mixed-dimension bulk before writing any item', async () => {
    const ops = createOperations(client);

    await expect(ops.batchUpdateEmbeddings([
      {
        nodeType: 'Function',
        identifier: { id },
        embedding: Array.from({ length: 1024 }, () => 0.25),
        embeddingTextHash: 'correct-dimension',
      },
      {
        nodeType: 'Function',
        identifier: { id },
        embedding: Array.from({ length: 768 }, () => 0.25),
        embeddingTextHash: 'wrong-dimension',
      },
    ])).rejects.toThrow('Embedding vector length 768 does not match persisted index dimension 1024');

    const readback = await client.roQuery<{ embedding: unknown }>(
      'MATCH (fn:Function {id: $id}) RETURN fn.embedding AS embedding',
      { params: { id } },
    );
    expect(readback.data[0]?.embedding).toBeNull();
  });
});
