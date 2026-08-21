/**
 * Regression test: indexProject() never wired up barrel re-export resolution.
 *
 * @codegraph/plugin-typescript's extractReExports() and pipeline.ts's
 * buildReExportIndex()/resolveReExportChain() (added for a separate fix) let
 * buildParsedFileEntities() resolve a callee reached through a barrel
 * (`import { doWork } from './index'` where index.ts does
 * `export { doWork } from './service'`) to the origin file, instead of the
 * barrel file, which has no matching Function node and so the CALLS edge
 * silently no-ops. That resolution is opt-in via PipelineOptions.barrelIndex,
 * built from every TypeScript file's extractReExports() output up front.
 * Nothing in indexProject() built or passed that index, so the fix was
 * inert: every call routed through a barrel was still dropped.
 *
 * This test drives the real indexProject() against a real temporary project
 * on disk and a real (embedded, no server) FalkorDBLite graph, because the
 * bug is about whether an actual CALLS edge lands in the graph, not about
 * which functions get invoked in what order.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createClient, resolveEmbeddedBinaryPaths, type GraphClient } from '@codegraph/graph';
import { registerPlugins } from '../pipeline';
import { indexProject, REEXPORT_HINT_PATTERN, buildBarrelResolutionIndexes } from '../indexer';

// The embedded driver ships binaries for darwin-arm64 and linux-x64 only.
const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

describe('REEXPORT_HINT_PATTERN', () => {
  it('matches a re-export with a block comment between export and the star', () => {
    expect(REEXPORT_HINT_PATTERN.test("export /* comment */ * from './x';")).toBe(true);
  });

  it('matches a re-export with a block comment between export and the brace', () => {
    expect(REEXPORT_HINT_PATTERN.test("export /* comment */ { x } from './x';")).toBe(true);
  });

  it('matches a re-export with a line comment between export and the star', () => {
    expect(REEXPORT_HINT_PATTERN.test("export // why star\n * from './x';")).toBe(true);
  });

  it('still matches the plain, uncommented forms', () => {
    expect(REEXPORT_HINT_PATTERN.test("export * from './x';")).toBe(true);
    expect(REEXPORT_HINT_PATTERN.test("export { x } from './x';")).toBe(true);
    expect(REEXPORT_HINT_PATTERN.test("export { x as y } from './x';")).toBe(true);
  });

  it('does not match code with no export statement at all', () => {
    expect(REEXPORT_HINT_PATTERN.test('const x = 1;\nfunction foo() {}\n')).toBe(false);
  });
});

describe('buildBarrelResolutionIndexes', () => {
  let dir: string;

  beforeAll(() => {
    registerPlugins();
    dir = mkdtempSync(join(tmpdir(), 'codegraph-barrel-indexes-'));

    writeFileSync(join(dir, 'other.ts'), 'export function otherFn(): number {\n  return 0;\n}\n');
    // Mixed barrel: a star re-export PLUS a local declaration. localExportsIndex
    // must capture localOnly even though REEXPORT_HINT_PATTERN also matches
    // this file for the re-export half.
    writeFileSync(
      join(dir, 'mixedBarrel.ts'),
      [
        "export * from './other';",
        '',
        'export function localOnly(): number {',
        '  return 1;',
        '}',
        '',
      ].join('\n'),
    );
    // Plain origin file: no `export ... from` syntax at all, so it never
    // matches REEXPORT_HINT_PATTERN. A chain can still land here (aliased
    // re-export chain case), so its local export must be collected anyway.
    writeFileSync(join(dir, 'origin.ts'), 'export function aliasedFn(): number {\n  return 1;\n}\n');
    // Pure re-export barrel: no local declarations of its own.
    writeFileSync(join(dir, 'aliasBarrel.ts'), "export { aliasedFn as renamedFn } from './origin';\n");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('collects local exports for every TypeScript file, including ones that do not match the re-export hint', async () => {
    const files = [
      join(dir, 'other.ts'),
      join(dir, 'mixedBarrel.ts'),
      join(dir, 'origin.ts'),
      join(dir, 'aliasBarrel.ts'),
    ];
    const { localExportsIndex } = await buildBarrelResolutionIndexes(files, 4);

    expect(localExportsIndex.get(join(dir, 'mixedBarrel.ts'))).toEqual(['localOnly']);
    expect(localExportsIndex.get(join(dir, 'origin.ts'))).toEqual(['aliasedFn']);
    expect(localExportsIndex.get(join(dir, 'other.ts'))).toEqual(['otherFn']);
    // A pure re-export barrel declares nothing locally, so it gets no entry.
    expect(localExportsIndex.has(join(dir, 'aliasBarrel.ts'))).toBe(false);
  });

  it('still collects the re-export index correctly alongside local exports', async () => {
    const files = [join(dir, 'mixedBarrel.ts'), join(dir, 'other.ts'), join(dir, 'aliasBarrel.ts')];
    const { barrelIndex } = await buildBarrelResolutionIndexes(files, 4);

    expect(barrelIndex.get(join(dir, 'mixedBarrel.ts'))).toEqual([
      { exportedName: '*', source: './other', sourceResolvedPath: join(dir, 'other.ts') },
    ]);
    expect(barrelIndex.get(join(dir, 'aliasBarrel.ts'))).toEqual([
      {
        exportedName: 'aliasedFn',
        localName: 'renamedFn',
        source: './origin',
        sourceResolvedPath: join(dir, 'origin.ts'),
      },
    ]);
    // other.ts has no re-export syntax, so no entry in barrelIndex (even
    // though it does have a localExportsIndex entry from the test above).
    expect(barrelIndex.has(join(dir, 'other.ts'))).toBe(false);
  });
});

describeIfAvailable('indexProject: barrel re-export resolution wiring', () => {
  let client: GraphClient;
  let dataDir: string;
  let projectDir: string;
  let previousEmbeddingProvider: string | undefined;

  beforeAll(async () => {
    // ensureIndexes() needs to know the embedding dimension even though this
    // test passes embeddings: false to indexProject() itself; 'none' skips
    // vector indexes entirely so no provider/API key is needed here.
    previousEmbeddingProvider = process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = 'none';

    dataDir = await mkdtemp(join(tmpdir(), 'cg-barrel-calls-'));
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'barrel_calls_regression',
    } as never);

    projectDir = mkdtempSync(join(tmpdir(), 'codegraph-barrel-calls-project-'));
    writeFileSync(
      join(projectDir, 'service.ts'),
      'export function doWork(): number {\n  return 1;\n}\n',
    );
    // Barrel: re-exports doWork under its own name, no local declaration.
    writeFileSync(join(projectDir, 'index.ts'), "export { doWork } from './service';\n");
    writeFileSync(
      join(projectDir, 'consumer.ts'),
      [
        "import { doWork } from './index';",
        '',
        'export function run(): number {',
        '  return doWork();',
        '}',
        '',
      ].join('\n'),
    );
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    if (previousEmbeddingProvider === undefined) {
      delete process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    } else {
      process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = previousEmbeddingProvider;
    }
  });

  it('creates a CALLS edge from the consumer to the origin function through a barrel', async () => {
    const result = await indexProject(projectDir, {
      client,
      includePatterns: ['*.ts'],
      embeddings: false,
      gitSync: false,
      force: true,
    });
    expect(result.success).toBe(true);

    const consumerPath = resolve(projectDir, 'consumer.ts');
    const servicePath = resolve(projectDir, 'service.ts');

    const edges = await client.roQuery<{ calleeFile: string }>(
      `MATCH (caller:Function {name: 'run', filePath: $consumerPath})-[:CALLS]->(callee:Function {name: 'doWork', filePath: $servicePath})
       RETURN callee.filePath AS calleeFile`,
      { params: { consumerPath, servicePath } },
    );

    expect(edges.data).toHaveLength(1);

    // The File-to-File IMPORTS edge must still point at the barrel: that is
    // the truthful import relationship, only CALLS resolution should chase
    // the chain to the origin.
    const importEdge = await client.roQuery(
      `MATCH (:File {filePath: $consumerPath})-[:IMPORTS]->(f:File {filePath: $indexPath}) RETURN f`,
      { params: { consumerPath, indexPath: resolve(projectDir, 'index.ts') } },
    );
    expect(importEdge.data).toHaveLength(1);
  });
});

describeIfAvailable('indexProject: barrel resolution edge cases (reviewer blockers)', () => {
  let client: GraphClient;
  let dataDir: string;
  let projectDir: string;
  let previousEmbeddingProvider: string | undefined;

  beforeAll(async () => {
    previousEmbeddingProvider = process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = 'none';

    dataDir = await mkdtemp(join(tmpdir(), 'cg-barrel-edge-cases-'));
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'barrel_edge_cases_regression',
    } as never);

    projectDir = mkdtempSync(join(tmpdir(), 'codegraph-barrel-edge-cases-project-'));

    // --- Mixed barrel: a star re-export plus a locally declared export.
    // localOnly is declared IN the barrel, not re-exported from elsewhere,
    // so a chain lookup for it must stop at the barrel, not fall through
    // the star hop into other.ts (which does not define it).
    writeFileSync(
      join(projectDir, 'other.ts'),
      'export function otherFn(): number {\n  return 0;\n}\n',
    );
    writeFileSync(
      join(projectDir, 'mixedBarrel.ts'),
      [
        "export * from './other';",
        '',
        'export function localOnly(): number {',
        '  return 1;',
        '}',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(projectDir, 'mixedConsumer.ts'),
      [
        "import { localOnly } from './mixedBarrel';",
        '',
        'export function runMixed(): number {',
        '  return localOnly();',
        '}',
        '',
      ].join('\n'),
    );

    // --- Aliased re-export chain: the barrel renames the origin's export
    // on the way out (`export { aliasedFn as renamedFn } from './origin'`).
    // The call site uses the local (barrel-side) name, but the Function
    // node the chain resolves to is declared under the origin-side name.
    writeFileSync(
      join(projectDir, 'origin.ts'),
      'export function aliasedFn(): number {\n  return 1;\n}\n',
    );
    writeFileSync(
      join(projectDir, 'aliasBarrel.ts'),
      "export { aliasedFn as renamedFn } from './origin';\n",
    );
    writeFileSync(
      join(projectDir, 'aliasConsumer.ts'),
      [
        "import { renamedFn } from './aliasBarrel';",
        '',
        'export function runAlias(): number {',
        '  return renamedFn();',
        '}',
        '',
      ].join('\n'),
    );

    const result = await indexProject(projectDir, {
      client,
      includePatterns: ['*.ts'],
      embeddings: false,
      gitSync: false,
      force: true,
    });
    if (!result.success) {
      throw new Error(`Fixture index failed: ${result.errorMessages.join('; ')}`);
    }
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    if (previousEmbeddingProvider === undefined) {
      delete process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    } else {
      process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = previousEmbeddingProvider;
    }
  });

  it('a mixed barrel resolves a locally declared name to itself, not through its own star hop', async () => {
    const consumerPath = resolve(projectDir, 'mixedConsumer.ts');
    const barrelPath = resolve(projectDir, 'mixedBarrel.ts');

    const edges = await client.roQuery(
      `MATCH (caller:Function {name: 'runMixed', filePath: $consumerPath})-[:CALLS]->(callee:Function {name: 'localOnly', filePath: $barrelPath})
       RETURN callee`,
      { params: { consumerPath, barrelPath } },
    );
    expect(edges.data).toHaveLength(1);
  });

  it('an aliased re-export chain resolves a renamed call to the origin file, under the origin declared name', async () => {
    const consumerPath = resolve(projectDir, 'aliasConsumer.ts');
    const originPath = resolve(projectDir, 'origin.ts');

    const edges = await client.roQuery(
      `MATCH (caller:Function {name: 'runAlias', filePath: $consumerPath})-[:CALLS]->(callee:Function {name: 'aliasedFn', filePath: $originPath})
       RETURN callee`,
      { params: { consumerPath, originPath } },
    );
    expect(edges.data).toHaveLength(1);
  });
});
