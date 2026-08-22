import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, resolveEmbeddedBinaryPaths, type GraphClient } from '../index';
import { createOperations } from '../operations';
import type { ParsedFileEntities } from '@codegraph/types';

const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

function emptyFile(path: string): ParsedFileEntities {
  return {
    file: {
      path,
      name: path.split('/').pop() ?? path,
      extension: 'ts',
      loc: 1,
      lastModified: '2026-08-22T00:00:00.000Z',
      hash: `hash:${path}`,
    },
    functions: [], classes: [], interfaces: [], variables: [], types: [], components: [], imports: [],
    callEdges: [], importsEdges: [], extendsEdges: [], implementsEdges: [], rendersEdges: [],
    hasMethodEdges: [], hasPropertyEdges: [], typeRefs: [], hasParamEdges: [], returnsEdges: [],
    usesTypeEdges: [], exportsEdges: [], importsSymbolEdges: [],
  };
}

describeIfAvailable('File stub upgrade', () => {
  let client: GraphClient | undefined;
  let dataDir: string | undefined;

  afterEach(async () => {
    await client?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    client = undefined;
    dataDir = undefined;
  });

  it('keeps one canonical File when an import creates the target before its real file is indexed', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'cg-file-upgrade-'));
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'file-node-upgrade',
    } as never);
    const ops = createOperations(client);
    const importer = emptyFile('/repo/importer.ts');
    importer.importsEdges.push({
      fromFilePath: '/repo/importer.ts',
      toFilePath: '/repo/target.ts',
      specifiers: ['target'],
    });

    await ops.batchCreateBulk([importer]);
    await ops.batchCreateBulk([emptyFile('/repo/target.ts')]);
    await ops.recomputeGraphDegrees();

    const result = await client.roQuery<{ count: number; externalCount: number }>(`
      MATCH (f:File {filePath: '/repo/target.ts'})
      RETURN count(f) AS count,
        sum(CASE WHEN f:External THEN 1 ELSE 0 END) AS externalCount
    `);
    expect(result.data).toEqual([{ count: 1, externalCount: 0 }]);

    const degrees = await client.roQuery<{ filePath: string; degree: number; symbolCount: number }>(`
      MATCH (f:File)
      RETURN f.filePath AS filePath, f.degree AS degree, f.symbolCount AS symbolCount
      ORDER BY filePath
    `);
    expect(degrees.data).toEqual([
      { filePath: '/repo/importer.ts', degree: 1, symbolCount: 0 },
      { filePath: '/repo/target.ts', degree: 1, symbolCount: 0 },
    ]);
  });
});
