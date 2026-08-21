/**
 * Class-qualified CALLS edge creation (reviewer blocker 3, batch-three
 * round-two fix set).
 *
 * Reproduces the fixture-b scenario the reviewer's attack script found: two
 * classes in the same file (Service, OtherService) both declare a method
 * with the same name (`work`). Before this fix, CREATE_CALLS_EDGE's MATCH
 * pattern `(callee:Function {name: $calleeName, filePath: $calleeFile})`
 * matched EVERY same-named Function node in that file, so a single
 * receiver-typed call (`s.work()` where `s` is bound to `Service`) created a
 * CALLS edge to BOTH Service.work() and OtherService.work(), regardless of
 * which class the receiver actually was.
 *
 * The fix threads a `calleeClassName` through the call-edge descriptor
 * (`ParsedFileEntities['callEdges'][number].calleeClassName`) and, when
 * present, routes the graph write through CREATE_CALLS_EDGE_BY_CLASS, which
 * matches the callee via `(cls:Class {name, filePath})-[:HAS_METHOD]->(callee:Function {name})`
 * instead of the ambiguous plain {name, filePath} match. This is exercised
 * through all three call-edge write paths: `createCallEdge` (used by
 * `batchUpsert`), and the inline per-edge queries in `batchUpsertBulk` and
 * `batchCreateBulk`.
 *
 * Uses the embedded FalkorDBLite driver (no Docker, no port 6379): a real
 * temp-dir graph instance, not a mock, so the actual Cypher is what's under
 * test.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type GraphClient } from '../client';
import { createOperations, type GraphOperations } from '../operations';
import type { FileEntity, FunctionEntity, ClassEntity, ParsedFileEntities } from '@codegraph/types';

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
    loc: 20,
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
  };
}

describeIfAvailable('CALLS edge creation: class-qualified matching', () => {
  let client: GraphClient;
  let ops: GraphOperations;
  let dataDir: string;

  const SERVICE_FILE = '/proj/service.ts';
  const APP_FILE = '/proj/app.ts';

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'codegraph-calls-by-class-'));
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: `test_calls_by_class_${Date.now()}`,
    });
    await client.ensureIndexes({ embeddingDim: 768 });
    ops = createOperations(client);
  }, 30_000);

  // Each test seeds its own fixture and asserts on exact edge counts, so the
  // graph must start empty every time, not accumulate CALLS edges (MERGE'd,
  // not duplicated) or CREATE-fail on already-existing nodes from a prior test.
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

  /** Sets up Service.work() and OtherService.work() with HAS_METHOD edges,
   *  plus an app.ts File node the caller can attach CALLS edges from. */
  async function seedTwoClassesSameMethodName(): Promise<void> {
    const serviceClass: ClassEntity = {
      id: 'Class:service.ts:Service:1',
      name: 'Service',
      filePath: SERVICE_FILE,
      startLine: 1,
      endLine: 3,
      isExported: true,
      isAbstract: false,
    };
    const otherServiceClass: ClassEntity = {
      id: 'Class:service.ts:OtherService:5',
      name: 'OtherService',
      filePath: SERVICE_FILE,
      startLine: 5,
      endLine: 7,
      isExported: true,
      isAbstract: false,
    };
    const serviceWork: FunctionEntity = {
      id: 'Function:service.ts:work:2',
      name: 'work',
      filePath: SERVICE_FILE,
      startLine: 2,
      endLine: 2,
      isExported: true,
      isAsync: false,
      isArrow: false,
      params: [],
    };
    const otherServiceWork: FunctionEntity = {
      id: 'Function:service.ts:work:6',
      name: 'work',
      filePath: SERVICE_FILE,
      startLine: 6,
      endLine: 6,
      isExported: true,
      isAsync: false,
      isArrow: false,
      params: [],
    };

    const serviceParsed = emptyParsed(makeFile(SERVICE_FILE));
    serviceParsed.classes = [serviceClass, otherServiceClass];
    serviceParsed.functions = [serviceWork, otherServiceWork];
    serviceParsed.hasMethodEdges = [
      { fromId: serviceClass.id!, toId: serviceWork.id!, isStatic: false, visibility: 'public' },
      { fromId: otherServiceClass.id!, toId: otherServiceWork.id!, isStatic: false, visibility: 'public' },
    ];

    const appParsed = emptyParsed(makeFile(APP_FILE));
    appParsed.functions = [
      { name: 'runBasic', filePath: APP_FILE, startLine: 1, endLine: 4, isExported: true, isAsync: false, isArrow: false, params: [] },
    ];

    await ops.batchUpsert(serviceParsed);
    await ops.batchUpsert(appParsed);
  }

  it('createCallEdge with calleeClassName creates exactly one edge, to the correctly-classed method', async () => {
    await seedTwoClassesSameMethodName();

    await ops.createCallEdge('runBasic', APP_FILE, 'work', SERVICE_FILE, 2, 'Function', 'direct', 'Service');

    const result = await client.roQuery<{ startLine: number }>(
      `MATCH (caller:Function {name: 'runBasic', filePath: $appFile})-[:CALLS]->(callee:Function {name: 'work', filePath: $serviceFile})
       RETURN callee.startLine AS startLine`,
      { params: { appFile: APP_FILE, serviceFile: SERVICE_FILE } },
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.startLine).toBe(2); // Service.work(), not OtherService.work() (startLine 6)
  });

  it('createCallEdge without calleeClassName keeps the pre-fix ambiguous behavior (both methods matched)', async () => {
    await seedTwoClassesSameMethodName();

    await ops.createCallEdge('runBasic', APP_FILE, 'work', SERVICE_FILE, 2);

    const result = await client.roQuery<{ startLine: number }>(
      `MATCH (caller:Function {name: 'runBasic', filePath: $appFile})-[:CALLS]->(callee:Function {name: 'work', filePath: $serviceFile})
       RETURN callee.startLine AS startLine ORDER BY startLine`,
      { params: { appFile: APP_FILE, serviceFile: SERVICE_FILE } },
    );

    // Documents the pre-fix, still-default (unqualified) behavior: this is
    // exactly the ambiguity blocker 3 fixes when calleeClassName IS supplied.
    expect(result.data).toHaveLength(2);
  });

  it('a missing HAS_METHOD edge drops the qualified call instead of falling back to an ambiguous match', async () => {
    await seedTwoClassesSameMethodName();

    // A class name that doesn't exist / isn't linked via HAS_METHOD to this
    // method: the OPTIONAL MATCH + WHERE callee IS NOT NULL guard must drop
    // this edge silently, not fall back to matching by name+filePath alone.
    await ops.createCallEdge('runBasic', APP_FILE, 'work', SERVICE_FILE, 2, 'Function', 'direct', 'NoSuchClass');

    const result = await client.roQuery<{ startLine: number }>(
      `MATCH (caller:Function {name: 'runBasic', filePath: $appFile})-[:CALLS]->(callee:Function {name: 'work', filePath: $serviceFile})
       RETURN callee.startLine AS startLine`,
      { params: { appFile: APP_FILE, serviceFile: SERVICE_FILE } },
    );

    expect(result.data).toHaveLength(0);
  });

  it('batchUpsertBulk creates exactly one class-qualified CALLS edge (incremental/MERGE write path)', async () => {
    await seedTwoClassesSameMethodName();

    const appParsed = emptyParsed(makeFile(APP_FILE));
    appParsed.callEdges = [
      {
        callerId: `Function:${APP_FILE}:runBasic`,
        calleeId: `Function:${SERVICE_FILE}:work`,
        line: 2,
        callerKind: 'Function',
        via: 'direct',
        calleeClassName: 'Service',
      },
    ];

    await ops.batchUpsertBulk([appParsed]);

    const result = await client.roQuery<{ startLine: number }>(
      `MATCH (caller:Function {name: 'runBasic', filePath: $appFile})-[:CALLS]->(callee:Function {name: 'work', filePath: $serviceFile})
       RETURN callee.startLine AS startLine`,
      { params: { appFile: APP_FILE, serviceFile: SERVICE_FILE } },
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.startLine).toBe(2);
  });

  it('batchCreateBulk creates exactly one class-qualified CALLS edge (full-reindex/CREATE write path)', async () => {
    // batchCreateBulk uses CREATE for nodes, so it needs a fresh graph
    // (guaranteed by the beforeEach cleanup above: CREATE would otherwise
    // collide with the MERGE-based fixtures other tests leave behind).
    const serviceClass: ClassEntity = {
      id: 'Class:service.ts:Service:1',
      name: 'Service',
      filePath: SERVICE_FILE,
      startLine: 1,
      endLine: 3,
      isExported: true,
      isAbstract: false,
    };
    const otherServiceClass: ClassEntity = {
      id: 'Class:service.ts:OtherService:5',
      name: 'OtherService',
      filePath: SERVICE_FILE,
      startLine: 5,
      endLine: 7,
      isExported: true,
      isAbstract: false,
    };
    const serviceWork: FunctionEntity = {
      id: 'Function:service.ts:work:2',
      name: 'work',
      filePath: SERVICE_FILE,
      startLine: 2,
      endLine: 2,
      isExported: true,
      isAsync: false,
      isArrow: false,
      params: [],
    };
    const otherServiceWork: FunctionEntity = {
      id: 'Function:service.ts:work:6',
      name: 'work',
      filePath: SERVICE_FILE,
      startLine: 6,
      endLine: 6,
      isExported: true,
      isAsync: false,
      isArrow: false,
      params: [],
    };
    const runBasic: FunctionEntity = {
      name: 'runBasic', filePath: APP_FILE, startLine: 1, endLine: 4, isExported: true, isAsync: false, isArrow: false, params: [],
    };

    const serviceParsed = emptyParsed(makeFile(SERVICE_FILE));
    serviceParsed.classes = [serviceClass, otherServiceClass];
    serviceParsed.functions = [serviceWork, otherServiceWork];
    serviceParsed.hasMethodEdges = [
      { fromId: serviceClass.id!, toId: serviceWork.id!, isStatic: false, visibility: 'public' },
      { fromId: otherServiceClass.id!, toId: otherServiceWork.id!, isStatic: false, visibility: 'public' },
    ];

    const appParsed = emptyParsed(makeFile(APP_FILE));
    appParsed.functions = [runBasic];
    appParsed.callEdges = [
      {
        callerId: `Function:${APP_FILE}:runBasic`,
        calleeId: `Function:${SERVICE_FILE}:work`,
        line: 2,
        callerKind: 'Function',
        via: 'direct',
        calleeClassName: 'Service',
      },
    ];

    await ops.batchCreateBulk([serviceParsed, appParsed]);

    const result = await client.roQuery<{ startLine: number }>(
      `MATCH (caller:Function {name: 'runBasic', filePath: $appFile})-[:CALLS]->(callee:Function {name: 'work', filePath: $serviceFile})
       RETURN callee.startLine AS startLine`,
      { params: { appFile: APP_FILE, serviceFile: SERVICE_FILE } },
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.startLine).toBe(2);
  });
});
