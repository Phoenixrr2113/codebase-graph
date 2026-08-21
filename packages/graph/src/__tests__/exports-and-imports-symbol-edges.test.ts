/**
 * EXPORTS and IMPORTS_SYMBOL graph writes (batch-three edge-truthfulness fix
 * set).
 *
 * Both edge types were declared in @codegraph/types, and EXPORTS even had a
 * Cypher template (CREATE_EXPORTS_EDGE), but neither was ever wired into any
 * write path (batchUpsert / batchUpsertBulk / batchCreateBulk), so no
 * EXPORTS or IMPORTS_SYMBOL edge was ever actually written to the graph.
 *
 * This covers:
 *   - EXPORTS: File → exported symbol, matched by (name, filePath,
 *     symbolKind). symbolKind disambiguates declaration merging (a Class
 *     and an Interface sharing the same name in the same file).
 *   - IMPORTS_SYMBOL: importing File → the imported symbol node (not the
 *     imported File), mirroring CALLS edge behavior: a plain MATCH on both
 *     sides that drops silently (zero rows, no error, no stub node) when
 *     the target symbol isn't in the graph (unparsed file, or genuinely
 *     external).
 *
 * Uses the embedded FalkorDBLite driver (no Docker, no port 6379): a real
 * temp-dir graph instance, not a mock.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type GraphClient } from '../client';
import { createOperations, type GraphOperations } from '../operations';
import type { FileEntity, FunctionEntity, ClassEntity, InterfaceEntity, ParsedFileEntities } from '@codegraph/types';

let falkordbliteAvailable = false;
try {
  await import('falkordblite');
  falkordbliteAvailable = true;
} catch {
  // not installed
}

const describeIfAvailable = falkordbliteAvailable ? describe : describe.skip;

function makeFile(path: string): FileEntity {
  return {
    path,
    name: path.split('/').pop()!,
    extension: 'ts',
    loc: 10,
    lastModified: '2025-01-01T00:00:00Z',
    hash: 'hash',
  };
}

/** Minimal ParsedFileEntities with everything empty except what a test fills in. */
function emptyParsed(file: FileEntity): ParsedFileEntities {
  return {
    file,
    functions: [],
    classes: [],
    interfaces: [],
    variables: [],
    types: [],
    components: [],
    imports: [],
    callEdges: [],
    importsEdges: [],
    extendsEdges: [],
    implementsEdges: [],
    rendersEdges: [],
    hasMethodEdges: [],
    hasPropertyEdges: [],
    typeRefs: [],
    hasParamEdges: [],
    returnsEdges: [],
    usesTypeEdges: [],
    exportsEdges: [],
    importsSymbolEdges: [],
  };
}

describeIfAvailable('EXPORTS and IMPORTS_SYMBOL edge creation', () => {
  let client: GraphClient;
  let ops: GraphOperations;
  let dataDir: string;

  const LIB_FILE = '/proj/lib.ts';
  const APP_FILE = '/proj/app.ts';

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'cg-eis-'));
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: `test_exports_imports_symbol_${Date.now()}`,
    });
    await client.ensureIndexes({ embeddingDim: 768 });
    ops = createOperations(client);
  }, 30_000);

  beforeEach(async () => {
    await client.query('MATCH (n) DETACH DELETE n', { params: {} });
  });

  afterAll(async () => {
    if (client) {
      try { await client.query('MATCH (n) DETACH DELETE n', { params: {} }); } catch { /* ok */ }
      await client.close();
    }
    try { await rm(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }, 15_000);

  describe('createExportsEdge', () => {
    it('creates a File -> Function EXPORTS edge with asName/isDefault set', async () => {
      const fn: FunctionEntity = {
        id: 'Function:lib.ts:doThing:1', name: 'doThing', filePath: LIB_FILE, startLine: 1, endLine: 2,
        isExported: true, isAsync: false, isArrow: false, params: [],
      };
      const parsed = emptyParsed(makeFile(LIB_FILE));
      parsed.functions = [fn];
      await ops.batchUpsert(parsed);

      await ops.createExportsEdge(LIB_FILE, 'doThing', 'Function', { asName: 'renamedThing', isDefault: false });

      const result = await client.roQuery<{ asName: string; isDefault: boolean }>(
        `MATCH (f:File {filePath: $lib})-[r:EXPORTS]->(fn:Function {name: 'doThing'})
         RETURN r.asName AS asName, r.isDefault AS isDefault`,
        { params: { lib: LIB_FILE } },
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.asName).toBe('renamedThing');
      expect(result.data[0]!.isDefault).toBe(false);
    });

    it('symbolKind disambiguates a declaration-merged Class and Interface sharing the same name', async () => {
      const cls: ClassEntity = {
        id: 'Class:lib.ts:Widget:1', name: 'Widget', filePath: LIB_FILE, startLine: 1, endLine: 2,
        isExported: true, isAbstract: false,
      };
      const iface: InterfaceEntity = {
        id: 'Interface:lib.ts:Widget:5', name: 'Widget', filePath: LIB_FILE, startLine: 5, endLine: 6,
        isExported: true,
      };
      const parsed = emptyParsed(makeFile(LIB_FILE));
      parsed.classes = [cls];
      parsed.interfaces = [iface];
      await ops.batchUpsert(parsed);

      await ops.createExportsEdge(LIB_FILE, 'Widget', 'Class');

      const classEdge = await client.roQuery<{ startLine: number }>(
        `MATCH (f:File {filePath: $lib})-[:EXPORTS]->(c:Class {name: 'Widget'}) RETURN c.startLine AS startLine`,
        { params: { lib: LIB_FILE } },
      );
      const ifaceEdge = await client.roQuery<{ startLine: number }>(
        `MATCH (f:File {filePath: $lib})-[:EXPORTS]->(i:Interface {name: 'Widget'}) RETURN i.startLine AS startLine`,
        { params: { lib: LIB_FILE } },
      );
      expect(classEdge.data).toHaveLength(1);
      expect(ifaceEdge.data).toHaveLength(0); // only the Class-kinded export was requested
    });

    it('drops silently when the symbol does not exist in the file', async () => {
      await ops.upsertFile(makeFile(LIB_FILE));

      await ops.createExportsEdge(LIB_FILE, 'nonexistent', 'Function');

      const result = await client.roQuery<{ count: number }>(
        `MATCH (f:File {filePath: $lib})-[r:EXPORTS]->() RETURN count(r) AS count`,
        { params: { lib: LIB_FILE } },
      );
      expect(result.data[0]!.count).toBe(0);
    });
  });

  describe('createImportsSymbolEdge', () => {
    it('binds to the real target symbol node when it exists', async () => {
      const fn: FunctionEntity = {
        id: 'Function:lib.ts:helper:1', name: 'helper', filePath: LIB_FILE, startLine: 1, endLine: 2,
        isExported: true, isAsync: false, isArrow: false, params: [],
      };
      const libParsed = emptyParsed(makeFile(LIB_FILE));
      libParsed.functions = [fn];
      await ops.batchUpsert(libParsed);
      await ops.batchUpsert(emptyParsed(makeFile(APP_FILE)));

      await ops.createImportsSymbolEdge(APP_FILE, LIB_FILE, 'helper', { alias: 'h', isDefault: false });

      const result = await client.roQuery<{ alias: string }>(
        `MATCH (a:File {filePath: $app})-[r:IMPORTS_SYMBOL]->(fn:Function {name: 'helper'})
         RETURN r.alias AS alias`,
        { params: { app: APP_FILE } },
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.alias).toBe('h');
    });

    it('creates one edge per merged declaration for a single imported name', async () => {
      const cls: ClassEntity = {
        id: 'Class:lib.ts:Joined:1', name: 'Joined', filePath: LIB_FILE, startLine: 1, endLine: 2,
        isExported: true, isAbstract: false,
      };
      const iface: InterfaceEntity = {
        id: 'Interface:lib.ts:Joined:5', name: 'Joined', filePath: LIB_FILE, startLine: 5, endLine: 6,
        isExported: true,
      };
      const libParsed = emptyParsed(makeFile(LIB_FILE));
      libParsed.classes = [cls];
      libParsed.interfaces = [iface];
      await ops.batchUpsert(libParsed);
      await ops.batchUpsert(emptyParsed(makeFile(APP_FILE)));

      await ops.createImportsSymbolEdge(APP_FILE, LIB_FILE, 'Joined');

      const result = await client.roQuery<{ label: string }>(
        `MATCH (:File {filePath: $app})-[:IMPORTS_SYMBOL]->(symbol {name: 'Joined', filePath: $lib})
         RETURN labels(symbol)[0] AS label
         ORDER BY label`,
        { params: { app: APP_FILE, lib: LIB_FILE } },
      );
      expect(result.data).toEqual([{ label: 'Class' }, { label: 'Interface' }]);
    });

    it('drops silently (no edge, no stub node) when the target symbol does not exist', async () => {
      // app.ts exists, but lib.ts was never parsed (unresolved/external from
      // this indexing pass's point of view): the edge must not appear, and
      // no stand-in Function node should have been MERGE'd into existence.
      await ops.batchUpsert(emptyParsed(makeFile(APP_FILE)));

      await ops.createImportsSymbolEdge(APP_FILE, LIB_FILE, 'neverParsed');

      const edgeResult = await client.roQuery<{ count: number }>(
        `MATCH (a:File {filePath: $app})-[r:IMPORTS_SYMBOL]->() RETURN count(r) AS count`,
        { params: { app: APP_FILE } },
      );
      expect(edgeResult.data[0]!.count).toBe(0);

      const stubResult = await client.roQuery<{ count: number }>(
        `MATCH (n {name: 'neverParsed'}) RETURN count(n) AS count`,
        { params: {} },
      );
      expect(stubResult.data[0]!.count).toBe(0);
    });
  });

  describe('batchUpsert wiring', () => {
    it('creates both EXPORTS and IMPORTS_SYMBOL edges from ParsedFileEntities', async () => {
      const fn: FunctionEntity = {
        id: 'Function:lib.ts:shared:1', name: 'shared', filePath: LIB_FILE, startLine: 1, endLine: 2,
        isExported: true, isAsync: false, isArrow: false, params: [],
      };
      const libParsed = emptyParsed(makeFile(LIB_FILE));
      libParsed.functions = [fn];
      libParsed.exportsEdges = [{ filePath: LIB_FILE, symbolName: 'shared', symbolKind: 'Function' }];
      await ops.batchUpsert(libParsed);

      const appParsed = emptyParsed(makeFile(APP_FILE));
      appParsed.importsSymbolEdges = [
        { fromFilePath: APP_FILE, toFilePath: LIB_FILE, symbolName: 'shared', isDefault: false },
      ];
      await ops.batchUpsert(appParsed);

      const exportsResult = await client.roQuery<{ count: number }>(
        `MATCH (:File {filePath: $lib})-[r:EXPORTS]->(:Function {name: 'shared'}) RETURN count(r) AS count`,
        { params: { lib: LIB_FILE } },
      );
      expect(exportsResult.data[0]!.count).toBe(1);

      const importsSymbolResult = await client.roQuery<{ count: number }>(
        `MATCH (:File {filePath: $app})-[r:IMPORTS_SYMBOL]->(:Function {name: 'shared'}) RETURN count(r) AS count`,
        { params: { app: APP_FILE } },
      );
      expect(importsSymbolResult.data[0]!.count).toBe(1);
    });
  });

  describe('batchUpsertBulk wiring (incremental/MERGE write path)', () => {
    it('creates both EXPORTS and IMPORTS_SYMBOL edges', async () => {
      const fn: FunctionEntity = {
        id: 'Function:lib.ts:bulkShared:1', name: 'bulkShared', filePath: LIB_FILE, startLine: 1, endLine: 2,
        isExported: true, isAsync: false, isArrow: false, params: [],
      };
      const libParsed = emptyParsed(makeFile(LIB_FILE));
      libParsed.functions = [fn];
      libParsed.exportsEdges = [{ filePath: LIB_FILE, symbolName: 'bulkShared', symbolKind: 'Function' }];

      const appParsed = emptyParsed(makeFile(APP_FILE));
      appParsed.importsSymbolEdges = [
        { fromFilePath: APP_FILE, toFilePath: LIB_FILE, symbolName: 'bulkShared', isDefault: false },
      ];

      await ops.batchUpsertBulk([libParsed, appParsed]);

      const exportsResult = await client.roQuery<{ count: number }>(
        `MATCH (:File {filePath: $lib})-[r:EXPORTS]->(:Function {name: 'bulkShared'}) RETURN count(r) AS count`,
        { params: { lib: LIB_FILE } },
      );
      expect(exportsResult.data[0]!.count).toBe(1);

      const importsSymbolResult = await client.roQuery<{ count: number }>(
        `MATCH (:File {filePath: $app})-[r:IMPORTS_SYMBOL]->(:Function {name: 'bulkShared'}) RETURN count(r) AS count`,
        { params: { app: APP_FILE } },
      );
      expect(importsSymbolResult.data[0]!.count).toBe(1);
    });
  });

  describe('batchCreateBulk wiring (full-reindex/CREATE write path)', () => {
    it('creates both EXPORTS and IMPORTS_SYMBOL edges', async () => {
      const fn: FunctionEntity = {
        id: 'Function:lib.ts:createShared:1', name: 'createShared', filePath: LIB_FILE, startLine: 1, endLine: 2,
        isExported: true, isAsync: false, isArrow: false, params: [],
      };
      const libParsed = emptyParsed(makeFile(LIB_FILE));
      libParsed.functions = [fn];
      libParsed.exportsEdges = [{ filePath: LIB_FILE, symbolName: 'createShared', symbolKind: 'Function' }];

      const appParsed = emptyParsed(makeFile(APP_FILE));
      appParsed.importsSymbolEdges = [
        { fromFilePath: APP_FILE, toFilePath: LIB_FILE, symbolName: 'createShared', isDefault: false },
      ];

      await ops.batchCreateBulk([libParsed, appParsed]);

      const exportsResult = await client.roQuery<{ count: number }>(
        `MATCH (:File {filePath: $lib})-[r:EXPORTS]->(:Function {name: 'createShared'}) RETURN count(r) AS count`,
        { params: { lib: LIB_FILE } },
      );
      expect(exportsResult.data[0]!.count).toBe(1);

      const importsSymbolResult = await client.roQuery<{ count: number }>(
        `MATCH (:File {filePath: $app})-[r:IMPORTS_SYMBOL]->(:Function {name: 'createShared'}) RETURN count(r) AS count`,
        { params: { app: APP_FILE } },
      );
      expect(importsSymbolResult.data[0]!.count).toBe(1);
    });
  });
});
