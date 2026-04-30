/**
 * Regression test: entity id property persisted on Function/Class/Interface/Variable nodes
 *
 * Smoke evidence that prompted this test:
 *   MATCH (f:Function) RETURN f.id LIMIT 5  → all null
 *   MATCH ()-[r:HAS_PARAM]->() RETURN count(*) → 0
 *
 * Root cause: the property mappers (functionToNodeProps etc.) did not include the `id`
 * field, and the MERGE Cyphers had no SET n.id clause. The Phase C/D edge descriptors
 * (HAS_METHOD, HAS_PROPERTY, HAS_PARAM, RETURNS, USES_TYPE) all MATCH on {id: $fromId}
 * or {id: $toId} — when the node has no id property, those MATCH clauses return zero
 * rows and the edges are silently dropped.
 *
 * This test injects entities with explicit ids through both code paths (batchUpsert and
 * batchUpsertBulk) and asserts that:
 *   1. Every Function/Class/Interface/Variable node has a non-null id
 *   2. The id stored on the node matches what was passed in
 *   3. HAS_PARAM, HAS_METHOD, HAS_PROPERTY, RETURNS, USES_TYPE edges are created
 *      (i.e., the MATCH-by-id lookups succeed)
 *
 * Uses FalkorDBLite so no Docker is required. Skipped if falkordblite is not installed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type GraphClient } from '../client';
import { createOperations, type GraphOperations } from '../operations';
import type {
  FileEntity,
  FunctionEntity,
  ClassEntity,
  InterfaceEntity,
  VariableEntity,
  TypeRefEntity,
  VariableKind,
} from '@codegraph/types';
import type { ParsedFileEntities } from '../schema';
import { mkdtemp, rm } from 'node:fs/promises';

// Skip tests if falkordblite is not available
let falkordbliteAvailable = false;
try {
  await import('falkordblite');
  falkordbliteAvailable = true;
} catch {
  // not installed
}

const describeIfAvailable = falkordbliteAvailable ? describe : describe.skip;

// ============================================================================
// Fixtures
// ============================================================================

const FILE_PATH = '/src/entity-id-test.ts';

function makeFile(): FileEntity {
  return {
    path: FILE_PATH,
    name: 'entity-id-test.ts',
    extension: 'ts',
    loc: 50,
    lastModified: '2025-01-01T00:00:00Z',
    hash: 'test-hash-entity-id',
  };
}

function makeFunction(id: string, name: string, startLine: number): FunctionEntity {
  return {
    id,
    name,
    filePath: FILE_PATH,
    startLine,
    endLine: startLine + 5,
    isExported: true,
    isAsync: false,
    isArrow: false,
    params: [],
  };
}

function makeClass(id: string, name: string, startLine: number): ClassEntity {
  return {
    id,
    name,
    filePath: FILE_PATH,
    startLine,
    endLine: startLine + 10,
    isExported: true,
    isAbstract: false,
  };
}

function makeInterface(id: string, name: string, startLine: number): InterfaceEntity {
  return {
    id,
    name,
    filePath: FILE_PATH,
    startLine,
    endLine: startLine + 5,
    isExported: true,
  };
}

function makeVariable(id: string, name: string, line: number): VariableEntity {
  return {
    id,
    name,
    filePath: FILE_PATH,
    line,
    kind: 'const' as VariableKind,
    isExported: false,
  };
}

function makeTypeRef(id: string, name: string): TypeRefEntity {
  return {
    id,
    name,
    language: 'typescript',
    isPrimitive: false,
  };
}

function makeEntities(): ParsedFileEntities {
  const fnId = 'Function:/src/entity-id-test.ts:testFn:1';
  const methodId = 'Function:/src/entity-id-test.ts:myMethod:20';
  const classId = 'Class:/src/entity-id-test.ts:TestClass:15';
  const ifaceId = 'Interface:/src/entity-id-test.ts:TestInterface:30';
  const varId = 'Variable:/src/entity-id-test.ts:testVar:40';
  const callerVarId = 'Variable:/src/entity-id-test.ts:zodChecker:50';
  const calleeFnId = 'Function:/src/entity-id-test.ts:floatSafeRemainder:60';
  const typeRefId = 'TypeRef:string';

  return {
    file: makeFile(),
    functions: [
      makeFunction(fnId, 'testFn', 1),
      makeFunction(methodId, 'myMethod', 20),
      makeFunction(calleeFnId, 'floatSafeRemainder', 60),
    ],
    classes: [makeClass(classId, 'TestClass', 15)],
    interfaces: [makeInterface(ifaceId, 'TestInterface', 30)],
    variables: [
      makeVariable(varId, 'testVar', 40),
      makeVariable(callerVarId, 'zodChecker', 50),
    ],
    types: [],
    components: [],
    imports: [],
    callEdges: [
      {
        callerId: callerVarId,
        calleeId: calleeFnId,
        line: 55,
        callerKind: 'Variable',
        via: 'closure',
      },
    ],
    importsEdges: [],
    extendsEdges: [],
    implementsEdges: [],
    rendersEdges: [],
    hasMethodEdges: [
      { fromId: classId, toId: methodId, isStatic: false, visibility: 'public' },
    ],
    hasPropertyEdges: [
      { fromId: classId, toId: varId, isStatic: false, visibility: 'public', isReadonly: false },
    ],
    typeRefs: [makeTypeRef(typeRefId, 'string')],
    hasParamEdges: [
      { fromId: fnId, toId: typeRefId, position: 0, name: 'input', isOptional: false },
    ],
    returnsEdges: [
      { fromId: fnId, toId: typeRefId, isAsync: false },
    ],
    usesTypeEdges: [
      { fromId: fnId, toId: typeRefId, kind: 'annotation' },
    ],
  };
}

// ============================================================================
// Tests
// ============================================================================

describeIfAvailable('Entity id persistence (FalkorDBLite)', () => {
  let client: GraphClient;
  let ops: GraphOperations;
  let dataDir: string;

  beforeAll(async () => {
    // Use /tmp directly with a short prefix to avoid Unix socket path length limits (106 bytes)
    dataDir = await mkdtemp('/tmp/cg-eid-');
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: `t_eid_${Date.now()}`,
    });
    ops = createOperations(client);
  }, 30_000);

  afterAll(async () => {
    try { await client.close(); } catch { /* best effort */ }
    try { await rm(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  describe('batchUpsert (single-file path)', () => {
    beforeAll(async () => {
      await ops.batchUpsert(makeEntities());
    });

    it('Function nodes have non-null id', async () => {
      const result = await client.roQuery<{ broken: number }>(
        `MATCH (f:Function {filePath: '${FILE_PATH}'}) WHERE f.id IS NULL RETURN count(f) AS broken`
      );
      expect(result.data[0]?.broken).toBe(0);
    });

    it('Class nodes have non-null id', async () => {
      const result = await client.roQuery<{ broken: number }>(
        `MATCH (c:Class {filePath: '${FILE_PATH}'}) WHERE c.id IS NULL RETURN count(c) AS broken`
      );
      expect(result.data[0]?.broken).toBe(0);
    });

    it('Interface nodes have non-null id', async () => {
      const result = await client.roQuery<{ broken: number }>(
        `MATCH (i:Interface {filePath: '${FILE_PATH}'}) WHERE i.id IS NULL RETURN count(i) AS broken`
      );
      expect(result.data[0]?.broken).toBe(0);
    });

    it('Variable nodes have non-null id', async () => {
      const result = await client.roQuery<{ broken: number }>(
        `MATCH (v:Variable {filePath: '${FILE_PATH}'}) WHERE v.id IS NULL RETURN count(v) AS broken`
      );
      expect(result.data[0]?.broken).toBe(0);
    });

    it('id stored on node matches the entity id passed in', async () => {
      const result = await client.roQuery<{ id: string }>(
        `MATCH (f:Function {name: 'testFn', filePath: '${FILE_PATH}'}) RETURN f.id AS id`
      );
      expect(result.data[0]?.id).toBe('Function:/src/entity-id-test.ts:testFn:1');
    });

    it('HAS_METHOD edge is created (id-based lookup works)', async () => {
      const result = await client.roQuery<{ count: number }>(
        `MATCH ()-[r:HAS_METHOD]->() RETURN count(r) AS count`
      );
      expect(result.data[0]?.count).toBeGreaterThan(0);
    });

    it('HAS_PROPERTY edge is created (id-based lookup works)', async () => {
      const result = await client.roQuery<{ count: number }>(
        `MATCH ()-[r:HAS_PROPERTY]->() RETURN count(r) AS count`
      );
      expect(result.data[0]?.count).toBeGreaterThan(0);
    });

    it('HAS_PARAM edge is created (id-based lookup works)', async () => {
      const result = await client.roQuery<{ count: number }>(
        `MATCH ()-[r:HAS_PARAM]->() RETURN count(r) AS count`
      );
      expect(result.data[0]?.count).toBeGreaterThan(0);
    });

    it('RETURNS edge is created (id-based lookup works)', async () => {
      const result = await client.roQuery<{ count: number }>(
        `MATCH ()-[r:RETURNS]->() RETURN count(r) AS count`
      );
      expect(result.data[0]?.count).toBeGreaterThan(0);
    });

    it('USES_TYPE edge is created (id-based lookup works)', async () => {
      const result = await client.roQuery<{ count: number }>(
        `MATCH ()-[r:USES_TYPE]->() RETURN count(r) AS count`
      );
      expect(result.data[0]?.count).toBeGreaterThan(0);
    });

    it('Variable-caller CALLS edge persists with via=closure', async () => {
      const result = await client.roQuery<{ via: string; count: number }>(
        `MATCH (v:Variable {name: 'zodChecker'})-[c:CALLS]->(f:Function {name: 'floatSafeRemainder'})
         RETURN c.via AS via, c.count AS count`
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual({ via: 'closure', count: 1 });
    });
  });

  describe('batchUpsertBulk (multi-file path)', () => {
    let client2: GraphClient;
    let ops2: GraphOperations;
    let dataDir2: string;

    beforeAll(async () => {
      // Use /tmp directly with a short prefix to avoid Unix socket path length limits (106 bytes)
      dataDir2 = await mkdtemp('/tmp/cg-eid-b-');
      client2 = await createClient({
        driver: 'falkordblite',
        databasePath: dataDir2,
        graphName: `t_eid_b_${Date.now()}`,
      });
      ops2 = createOperations(client2);
      await ops2.batchUpsertBulk([makeEntities()]);
    }, 30_000);

    afterAll(async () => {
      try { await client2.close(); } catch { /* best effort */ }
      try { await rm(dataDir2, { recursive: true, force: true }); } catch { /* best effort */ }
    });

    it('Function nodes have non-null id (bulk path)', async () => {
      const result = await client2.roQuery<{ broken: number }>(
        `MATCH (f:Function {filePath: '${FILE_PATH}'}) WHERE f.id IS NULL RETURN count(f) AS broken`
      );
      expect(result.data[0]?.broken).toBe(0);
    });

    it('Class nodes have non-null id (bulk path)', async () => {
      const result = await client2.roQuery<{ broken: number }>(
        `MATCH (c:Class {filePath: '${FILE_PATH}'}) WHERE c.id IS NULL RETURN count(c) AS broken`
      );
      expect(result.data[0]?.broken).toBe(0);
    });

    it('Interface nodes have non-null id (bulk path)', async () => {
      const result = await client2.roQuery<{ broken: number }>(
        `MATCH (i:Interface {filePath: '${FILE_PATH}'}) WHERE i.id IS NULL RETURN count(i) AS broken`
      );
      expect(result.data[0]?.broken).toBe(0);
    });

    it('Variable nodes have non-null id (bulk path)', async () => {
      const result = await client2.roQuery<{ broken: number }>(
        `MATCH (v:Variable {filePath: '${FILE_PATH}'}) WHERE v.id IS NULL RETURN count(v) AS broken`
      );
      expect(result.data[0]?.broken).toBe(0);
    });

    it('HAS_PARAM edge is created (bulk path)', async () => {
      const result = await client2.roQuery<{ count: number }>(
        `MATCH ()-[r:HAS_PARAM]->() RETURN count(r) AS count`
      );
      expect(result.data[0]?.count).toBeGreaterThan(0);
    });

    it('RETURNS edge is created (bulk path)', async () => {
      const result = await client2.roQuery<{ count: number }>(
        `MATCH ()-[r:RETURNS]->() RETURN count(r) AS count`
      );
      expect(result.data[0]?.count).toBeGreaterThan(0);
    });

    it('HAS_METHOD edge is created (bulk path)', async () => {
      const result = await client2.roQuery<{ count: number }>(
        `MATCH ()-[r:HAS_METHOD]->() RETURN count(r) AS count`
      );
      expect(result.data[0]?.count).toBeGreaterThan(0);
    });
  });
});
