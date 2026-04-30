/**
 * Graph CRUD Operations — FalkorDB Integration Tests
 *
 * Tests entity upserts, edge creation, batchUpsert, project operations,
 * vector search, and clearAll against a real FalkorDB Docker instance.
 *
 * Prerequisites: docker compose up -d falkordb
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createClient,
  type GraphClient,
  createOperations,
  type GraphOperations,
  type ParsedFileEntities,
} from '../index';
import type {
  FileEntity,
  FunctionEntity,
  ClassEntity,
  InterfaceEntity,
  VariableEntity,
  ComponentEntity,
} from '@codegraph/types';

const GRAPH_NAME = `test_ops_${Date.now()}`;

// ============================================================================
// Test Fixtures
// ============================================================================

function makeFile(overrides?: Partial<FileEntity>): FileEntity {
  return {
    path: '/src/index.ts',
    name: 'index.ts',
    extension: 'ts',
    loc: 100,
    lastModified: '2025-01-01T00:00:00Z',
    hash: 'abc123',
    ...overrides,
  };
}

function makeFunction(overrides?: Partial<FunctionEntity>): FunctionEntity {
  return {
    name: 'myFunction',
    filePath: '/src/index.ts',
    startLine: 10,
    endLine: 20,
    isExported: true,
    isAsync: false,
    isArrow: false,
    params: [],
    ...overrides,
  };
}

function makeClass(overrides?: Partial<ClassEntity>): ClassEntity {
  return {
    name: 'MyClass',
    filePath: '/src/index.ts',
    startLine: 30,
    endLine: 50,
    isExported: true,
    isAbstract: false,
    ...overrides,
  };
}

function makeInterface(overrides?: Partial<InterfaceEntity>): InterfaceEntity {
  return {
    name: 'MyInterface',
    filePath: '/src/index.ts',
    startLine: 60,
    endLine: 70,
    isExported: true,
    ...overrides,
  };
}

function makeVariable(overrides?: Partial<VariableEntity>): VariableEntity {
  return {
    name: 'myVar',
    filePath: '/src/index.ts',
    line: 5,
    kind: 'const',
    isExported: false,
    ...overrides,
  };
}

function makeComponent(overrides?: Partial<ComponentEntity>): ComponentEntity {
  return {
    name: 'MyComponent',
    filePath: '/src/index.ts',
    startLine: 80,
    endLine: 100,
    isExported: true,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Graph CRUD Operations (FalkorDB)', () => {
  let client: GraphClient;
  let ops: GraphOperations;

  beforeAll(async () => {
    try {
      client = await createClient({
        driver: 'falkordb',
        host: 'localhost',
        port: 6379,
        graphName: GRAPH_NAME,
      });
    } catch (error) {
      console.error('FalkorDB not available — skipping tests. Run: docker compose up -d falkordb');
      throw error;
    }

    await client.ensureIndexes();
    ops = createOperations(client);
  });

  afterAll(async () => {
    try {
      await client.query(`MATCH (n) DETACH DELETE n`, { params: {} });
    } catch { /* best effort */ }
    try {
      await client.close();
    } catch { /* best effort */ }
  });

  // ==========================================================================
  // File CRUD
  // ==========================================================================

  describe('File CRUD', () => {
    it('upsertFile creates a File node', async () => {
      const file = makeFile({ path: '/src/file-crud-1.ts', name: 'file-crud-1.ts' });
      await ops.upsertFile(file);

      const result = await client.roQuery<{ count: number }>(
        `MATCH (n:File {filePath: '/src/file-crud-1.ts'}) RETURN count(n) as count`
      );
      expect(result.data[0]?.count).toBe(1);
    });

    it('upsertFile updates properties on re-upsert', async () => {
      const file = makeFile({ path: '/src/file-crud-2.ts', name: 'file-crud-2.ts', loc: 50, hash: 'hash-v1' });
      await ops.upsertFile(file);

      // Update loc and hash
      await ops.upsertFile({ ...file, loc: 200, hash: 'hash-v2' });

      const result = await client.roQuery<{ loc: number; hash: string }>(
        `MATCH (f:File {filePath: '/src/file-crud-2.ts'}) RETURN f.loc as loc, f.hash as hash`
      );
      expect(result.data[0]?.loc).toBe(200);
      expect(result.data[0]?.hash).toBe('hash-v2');
    });

    it('deleteFileEntities removes file and its children', async () => {
      const file = makeFile({ path: '/src/file-crud-3.ts', name: 'file-crud-3.ts' });
      await ops.upsertFile(file);
      await ops.upsertFunction(makeFunction({ name: 'childFn', filePath: '/src/file-crud-3.ts' }));

      // Verify file exists
      const before = await client.roQuery<{ count: number }>(
        `MATCH (f:File {filePath: '/src/file-crud-3.ts'}) RETURN count(f) as count`
      );
      expect(before.data[0]?.count).toBe(1);

      await ops.deleteFileEntities('/src/file-crud-3.ts');

      const afterFile = await client.roQuery<{ count: number }>(
        `MATCH (f:File {filePath: '/src/file-crud-3.ts'}) RETURN count(f) as count`
      );
      expect(afterFile.data[0]?.count).toBe(0);

      const afterFn = await client.roQuery<{ count: number }>(
        `MATCH (fn:Function) WHERE fn.name = 'childFn' AND fn.filePath = '/src/file-crud-3.ts' RETURN count(fn) as count`
      );
      expect(afterFn.data[0]?.count).toBe(0);
    });
  });

  // ==========================================================================
  // Entity Upserts
  // ==========================================================================

  describe('Entity Upserts', () => {
    it('upsertFunction creates Function node + CONTAINS edge from File', async () => {
      const file = makeFile({ path: '/src/entity-fn.ts', name: 'entity-fn.ts' });
      await ops.upsertFile(file);

      const fn = makeFunction({
        name: 'greet',
        filePath: '/src/entity-fn.ts',
        startLine: 1,
        endLine: 5,
        isAsync: true,
        params: [{ name: 'name', type: 'string' }],
        returnType: 'string',
      });
      await ops.upsertFunction(fn);

      const fnResult = await client.roQuery<{ count: number }>(
        `MATCH (fn:Function) WHERE fn.name = 'greet' AND fn.filePath = '/src/entity-fn.ts' RETURN count(fn) as count`
      );
      expect(fnResult.data[0]?.count).toBe(1);

      const edgeResult = await client.roQuery<{ count: number }>(
        `MATCH (f:File {filePath: '/src/entity-fn.ts'})-[r:CONTAINS]->(fn:Function) WHERE fn.name = 'greet' RETURN count(r) as count`
      );
      expect(edgeResult.data[0]?.count).toBe(1);
    });

    it('upsertClass creates Class node + CONTAINS edge from File', async () => {
      const file = makeFile({ path: '/src/entity-cls.ts', name: 'entity-cls.ts' });
      await ops.upsertFile(file);

      const cls = makeClass({
        name: 'Animal',
        filePath: '/src/entity-cls.ts',
        startLine: 1,
        endLine: 30,
        isAbstract: true,
      });
      await ops.upsertClass(cls);

      const clsResult = await client.roQuery<{ count: number }>(
        `MATCH (c:Class) WHERE c.name = 'Animal' AND c.filePath = '/src/entity-cls.ts' RETURN count(c) as count`
      );
      expect(clsResult.data[0]?.count).toBe(1);

      const edgeResult = await client.roQuery<{ count: number }>(
        `MATCH (f:File {filePath: '/src/entity-cls.ts'})-[r:CONTAINS]->(c:Class) WHERE c.name = 'Animal' RETURN count(r) as count`
      );
      expect(edgeResult.data[0]?.count).toBe(1);
    });

    it('upsertInterface creates Interface node + CONTAINS edge from File', async () => {
      const file = makeFile({ path: '/src/entity-iface.ts', name: 'entity-iface.ts' });
      await ops.upsertFile(file);

      const iface = makeInterface({
        name: 'Serializable',
        filePath: '/src/entity-iface.ts',
        startLine: 1,
        endLine: 10,
      });
      await ops.upsertInterface(iface);

      const ifaceResult = await client.roQuery<{ count: number }>(
        `MATCH (i:Interface) WHERE i.name = 'Serializable' AND i.filePath = '/src/entity-iface.ts' RETURN count(i) as count`
      );
      expect(ifaceResult.data[0]?.count).toBe(1);

      const edgeResult = await client.roQuery<{ count: number }>(
        `MATCH (f:File {filePath: '/src/entity-iface.ts'})-[r:CONTAINS]->(i:Interface) WHERE i.name = 'Serializable' RETURN count(r) as count`
      );
      expect(edgeResult.data[0]?.count).toBe(1);
    });

    it('upsertVariable creates Variable node + CONTAINS edge from File', async () => {
      const file = makeFile({ path: '/src/entity-var.ts', name: 'entity-var.ts' });
      await ops.upsertFile(file);

      const variable = makeVariable({
        name: 'MAX_SIZE',
        filePath: '/src/entity-var.ts',
        line: 3,
        kind: 'const',
        isExported: true,
        type: 'number',
      });
      await ops.upsertVariable(variable);

      const varResult = await client.roQuery<{ count: number }>(
        `MATCH (v:Variable) WHERE v.name = 'MAX_SIZE' AND v.filePath = '/src/entity-var.ts' RETURN count(v) as count`
      );
      expect(varResult.data[0]?.count).toBe(1);

      const edgeResult = await client.roQuery<{ count: number }>(
        `MATCH (f:File {filePath: '/src/entity-var.ts'})-[r:CONTAINS]->(v:Variable) WHERE v.name = 'MAX_SIZE' RETURN count(r) as count`
      );
      expect(edgeResult.data[0]?.count).toBe(1);
    });

    it('upsertComponent creates Component node + CONTAINS edge from File', async () => {
      const file = makeFile({ path: '/src/entity-comp.tsx', name: 'entity-comp.tsx', extension: 'tsx' });
      await ops.upsertFile(file);

      const comp = makeComponent({
        name: 'Button',
        filePath: '/src/entity-comp.tsx',
        startLine: 1,
        endLine: 20,
        props: [{ name: 'label', type: 'string', required: true }],
        propsType: 'ButtonProps',
      });
      await ops.upsertComponent(comp);

      const compResult = await client.roQuery<{ count: number }>(
        `MATCH (comp:Component) WHERE comp.name = 'Button' AND comp.filePath = '/src/entity-comp.tsx' RETURN count(comp) as count`
      );
      expect(compResult.data[0]?.count).toBe(1);

      const edgeResult = await client.roQuery<{ count: number }>(
        `MATCH (f:File {filePath: '/src/entity-comp.tsx'})-[r:CONTAINS]->(comp:Component) WHERE comp.name = 'Button' RETURN count(r) as count`
      );
      expect(edgeResult.data[0]?.count).toBe(1);
    });
  });

  // ==========================================================================
  // Edge Creation
  // ==========================================================================

  describe('Edge Creation', () => {
    it('createCallEdge creates CALLS relationship between two functions', async () => {
      const file = makeFile({ path: '/src/edge-calls.ts', name: 'edge-calls.ts' });
      await ops.upsertFile(file);
      await ops.upsertFunction(makeFunction({ name: 'caller', filePath: '/src/edge-calls.ts', startLine: 1, endLine: 5 }));
      await ops.upsertFunction(makeFunction({ name: 'callee', filePath: '/src/edge-calls.ts', startLine: 10, endLine: 15 }));

      await ops.createCallEdge('caller', '/src/edge-calls.ts', 'callee', '/src/edge-calls.ts', 3);

      const result = await client.roQuery<{ count: number }>(
        `MATCH (a:Function)-[r:CALLS]->(b:Function) WHERE a.name = 'caller' AND b.name = 'callee' RETURN count(r) as count`
      );
      expect(result.data[0]?.count).toBe(1);
    });

    it('createImportsEdge creates IMPORTS relationship between two files', async () => {
      const fromFile = makeFile({ path: '/src/edge-imports-from.ts', name: 'edge-imports-from.ts' });
      const toFile = makeFile({ path: '/src/edge-imports-to.ts', name: 'edge-imports-to.ts' });
      await ops.upsertFile(fromFile);
      await ops.upsertFile(toFile);

      await ops.createImportsEdge('/src/edge-imports-from.ts', '/src/edge-imports-to.ts', ['foo', 'bar']);

      const result = await client.roQuery<{ count: number }>(
        `MATCH (a:File {filePath: '/src/edge-imports-from.ts'})-[r:IMPORTS]->(b:File {filePath: '/src/edge-imports-to.ts'}) RETURN count(r) as count`
      );
      expect(result.data[0]?.count).toBe(1);
    });

    it('createExtendsEdge creates EXTENDS relationship between child and parent classes', async () => {
      const file = makeFile({ path: '/src/edge-extends.ts', name: 'edge-extends.ts' });
      await ops.upsertFile(file);
      await ops.upsertClass(makeClass({ name: 'Parent', filePath: '/src/edge-extends.ts', startLine: 1, endLine: 10 }));
      await ops.upsertClass(makeClass({ name: 'Child', filePath: '/src/edge-extends.ts', startLine: 15, endLine: 30 }));

      await ops.createExtendsEdge('Child', '/src/edge-extends.ts', 'Parent', '/src/edge-extends.ts');

      const result = await client.roQuery<{ count: number }>(
        `MATCH (child:Class)-[r:EXTENDS]->(parent:Class) WHERE child.name = 'Child' AND parent.name = 'Parent' RETURN count(r) as count`
      );
      expect(result.data[0]?.count).toBe(1);
    });

    it('createImplementsEdge creates IMPLEMENTS relationship between class and interface', async () => {
      const file = makeFile({ path: '/src/edge-impl.ts', name: 'edge-impl.ts' });
      await ops.upsertFile(file);
      await ops.upsertClass(makeClass({ name: 'Concrete', filePath: '/src/edge-impl.ts', startLine: 1, endLine: 20 }));
      await ops.upsertInterface(makeInterface({ name: 'Abstract', filePath: '/src/edge-impl.ts', startLine: 25, endLine: 35 }));

      await ops.createImplementsEdge('Concrete', '/src/edge-impl.ts', 'Abstract', '/src/edge-impl.ts');

      const result = await client.roQuery<{ count: number }>(
        `MATCH (c:Class)-[r:IMPLEMENTS]->(i:Interface) WHERE c.name = 'Concrete' AND i.name = 'Abstract' RETURN count(r) as count`
      );
      expect(result.data[0]?.count).toBe(1);
    });
  });

  // ==========================================================================
  // batchUpsert
  // ==========================================================================

  describe('batchUpsert', () => {
    function makeBatchEntities(filePath = '/src/batch.ts'): ParsedFileEntities {
      return {
        file: makeFile({ path: filePath, name: 'batch.ts' }),
        functions: [
          makeFunction({ name: 'batchFnA', filePath, startLine: 1, endLine: 5 }),
          makeFunction({ name: 'batchFnB', filePath, startLine: 10, endLine: 15 }),
        ],
        classes: [
          makeClass({ name: 'BatchClass', filePath, startLine: 20, endLine: 40 }),
        ],
        interfaces: [
          makeInterface({ name: 'BatchIface', filePath, startLine: 45, endLine: 55 }),
        ],
        variables: [
          makeVariable({ name: 'BATCH_VAR', filePath, line: 60 }),
        ],
        types: [
          { name: 'BatchType', filePath, startLine: 65, endLine: 65, isExported: true, kind: 'type' as const },
        ],
        components: [],
        imports: [],
        callEdges: [
          {
            callerId: `Function:${filePath}:batchFnA:1`,
            calleeId: `Function:${filePath}:batchFnB:10`,
            line: 3,
            callerKind: 'Function' as const,
            via: 'direct' as const,
          },
        ],
        importsEdges: [],
        extendsEdges: [],
        implementsEdges: [],
        rendersEdges: [],
      };
    }

    it('full ParsedFileEntities round-trip — creates file, functions, classes', async () => {
      const entities = makeBatchEntities('/src/batch-roundtrip.ts');
      await ops.batchUpsert(entities);

      const fileCount = await client.roQuery<{ count: number }>(
        `MATCH (f:File {filePath: '/src/batch-roundtrip.ts'}) RETURN count(f) as count`
      );
      expect(fileCount.data[0]?.count).toBe(1);

      const fnCount = await client.roQuery<{ count: number }>(
        `MATCH (fn:Function) WHERE fn.filePath = '/src/batch-roundtrip.ts' RETURN count(fn) as count`
      );
      expect(fnCount.data[0]?.count).toBe(2);

      const clsCount = await client.roQuery<{ count: number }>(
        `MATCH (c:Class) WHERE c.filePath = '/src/batch-roundtrip.ts' RETURN count(c) as count`
      );
      expect(clsCount.data[0]?.count).toBe(1);

      const ifaceCount = await client.roQuery<{ count: number }>(
        `MATCH (i:Interface) WHERE i.filePath = '/src/batch-roundtrip.ts' RETURN count(i) as count`
      );
      expect(ifaceCount.data[0]?.count).toBe(1);

      const varCount = await client.roQuery<{ count: number }>(
        `MATCH (v:Variable) WHERE v.filePath = '/src/batch-roundtrip.ts' RETURN count(v) as count`
      );
      expect(varCount.data[0]?.count).toBe(1);

      const typeCount = await client.roQuery<{ count: number }>(
        `MATCH (t:Type) WHERE t.filePath = '/src/batch-roundtrip.ts' RETURN count(t) as count`
      );
      expect(typeCount.data[0]?.count).toBe(1);
    });

    it('batchUpsert is idempotent — second call does not create duplicates', async () => {
      const entities = makeBatchEntities('/src/batch-idempotent.ts');
      await ops.batchUpsert(entities);
      await ops.batchUpsert(entities);

      const fnCount = await client.roQuery<{ count: number }>(
        `MATCH (fn:Function) WHERE fn.filePath = '/src/batch-idempotent.ts' RETURN count(fn) as count`
      );
      expect(fnCount.data[0]?.count).toBe(2);

      const fileCount = await client.roQuery<{ count: number }>(
        `MATCH (f:File {filePath: '/src/batch-idempotent.ts'}) RETURN count(f) as count`
      );
      expect(fileCount.data[0]?.count).toBe(1);
    });

    it('batchUpsert creates call edges and import edges', async () => {
      const filePath = '/src/batch-edges.ts';
      const importedPath = '/src/batch-edges-dep.ts';

      // First create the imported file so IMPORTS edge can reference it
      await ops.upsertFile(makeFile({ path: importedPath, name: 'batch-edges-dep.ts' }));

      const entities: ParsedFileEntities = {
        file: makeFile({ path: filePath, name: 'batch-edges.ts' }),
        functions: [
          makeFunction({ name: 'edgeFnA', filePath, startLine: 1, endLine: 5 }),
          makeFunction({ name: 'edgeFnB', filePath, startLine: 10, endLine: 15 }),
        ],
        classes: [],
        interfaces: [],
        variables: [],
        types: [],
        components: [],
        imports: [],
        callEdges: [
          {
            callerId: `Function:${filePath}:edgeFnA:1`,
            calleeId: `Function:${filePath}:edgeFnB:10`,
            line: 3,
            callerKind: 'Function' as const,
            via: 'direct' as const,
          },
        ],
        importsEdges: [
          { fromFilePath: filePath, toFilePath: importedPath, specifiers: ['util'] },
        ],
        extendsEdges: [],
        implementsEdges: [],
        rendersEdges: [],
      };

      await ops.batchUpsert(entities);

      const callCount = await client.roQuery<{ count: number }>(
        `MATCH (a:Function)-[r:CALLS]->(b:Function) WHERE a.name = 'edgeFnA' AND b.name = 'edgeFnB' RETURN count(r) as count`
      );
      expect(callCount.data[0]?.count).toBe(1);

      const importCount = await client.roQuery<{ count: number }>(
        `MATCH (a:File {filePath: '${filePath}'})-[r:IMPORTS]->(b:File {filePath: '${importedPath}'}) RETURN count(r) as count`
      );
      expect(importCount.data[0]?.count).toBe(1);
    });
  });

  // ==========================================================================
  // Project Operations
  // ==========================================================================

  describe('Project Operations', () => {
    const now = new Date().toISOString();

    it('upsertProject + getProjectByRoot round-trip', async () => {
      await ops.upsertProject({
        id: 'proj-1',
        name: 'my-project',
        rootPath: '/home/user/my-project',
        createdAt: now,
        lastParsed: now,
        fileCount: 42,
      });

      const project = await ops.getProjectByRoot('/home/user/my-project');
      expect(project).not.toBeNull();
      expect(project!.id).toBe('proj-1');
      expect(project!.name).toBe('my-project');
      expect(project!.rootPath).toBe('/home/user/my-project');
      expect(project!.fileCount).toBe(42);
    });

    it('getProjects returns all projects', async () => {
      await ops.upsertProject({
        id: 'proj-2',
        name: 'second-project',
        rootPath: '/home/user/second-project',
        createdAt: now,
        lastParsed: now,
      });

      const projects = await ops.getProjects();
      expect(projects.length).toBeGreaterThanOrEqual(2);
      const ids = projects.map(p => p.id);
      expect(ids).toContain('proj-1');
      expect(ids).toContain('proj-2');
    });

    it('linkProjectFile links a project to a file', async () => {
      const file = makeFile({ path: '/src/project-linked.ts', name: 'project-linked.ts' });
      await ops.upsertFile(file);

      await ops.linkProjectFile('proj-1', '/src/project-linked.ts');

      const result = await client.roQuery<{ count: number }>(
        `MATCH (p:Project {id: 'proj-1'})-[r:HAS_FILE]->(f:File {filePath: '/src/project-linked.ts'}) RETURN count(r) as count`
      );
      expect(result.data[0]?.count).toBe(1);
    });

    it('deleteProject removes project node', async () => {
      await ops.upsertProject({
        id: 'proj-delete-test',
        name: 'delete-me',
        rootPath: '/home/user/delete-me',
        createdAt: now,
        lastParsed: now,
      });

      await ops.deleteProject('proj-delete-test');

      const projectCount = await client.roQuery<{ count: number }>(
        `MATCH (p:Project {id: 'proj-delete-test'}) RETURN count(p) as count`
      );
      expect(projectCount.data[0]?.count).toBe(0);
    });
  });

  // ==========================================================================
  // Smart File Removal (PERF.4)
  // ==========================================================================

  describe('removeFileAndCleanup (PERF.4)', () => {
    it('removes file node and orphaned entities', async () => {
      // Setup: File A with a function
      await ops.upsertFile(makeFile({ path: '/src/perf4-a.ts', name: 'perf4-a.ts' }));
      await ops.upsertFunction(makeFunction({ name: 'fnA', filePath: '/src/perf4-a.ts', startLine: 1 }));

      // Verify setup
      const before = await client.roQuery<{ count: number }>(
        `MATCH (f:File {filePath: '/src/perf4-a.ts'}) RETURN count(f) as count`
      );
      expect(before.data[0]?.count).toBe(1);

      // Remove file
      await ops.removeFileAndCleanup('/src/perf4-a.ts');

      // File node should be gone
      const afterFile = await client.roQuery<{ count: number }>(
        `MATCH (f:File {filePath: '/src/perf4-a.ts'}) RETURN count(f) as count`
      );
      expect(afterFile.data[0]?.count).toBe(0);

      // Orphaned function should also be gone
      const afterFn = await client.roQuery<{ count: number }>(
        `MATCH (fn:Function {name: 'fnA', filePath: '/src/perf4-a.ts'}) RETURN count(fn) as count`
      );
      expect(afterFn.data[0]?.count).toBe(0);
    });

    it('preserves entities with incoming cross-file CALLS edges', async () => {
      // Setup: File A has fnA, File B has fnB, fnA CALLS fnB
      await ops.upsertFile(makeFile({ path: '/src/perf4-caller.ts', name: 'perf4-caller.ts' }));
      await ops.upsertFunction(makeFunction({ name: 'fnCaller', filePath: '/src/perf4-caller.ts', startLine: 1 }));

      await ops.upsertFile(makeFile({ path: '/src/perf4-callee.ts', name: 'perf4-callee.ts' }));
      await ops.upsertFunction(makeFunction({ name: 'fnCallee', filePath: '/src/perf4-callee.ts', startLine: 1 }));

      // Create cross-file CALLS edge: fnCaller → fnCallee
      await ops.createCallEdge('fnCaller', '/src/perf4-caller.ts', 'fnCallee', '/src/perf4-callee.ts', 5);

      // Verify the CALLS edge exists
      const edgeBefore = await client.roQuery<{ count: number }>(
        `MATCH (a:Function {name: 'fnCaller'})-[:CALLS]->(b:Function {name: 'fnCallee'}) RETURN count(*) as count`
      );
      expect(edgeBefore.data[0]?.count).toBe(1);

      // Remove the CALLEE file — the function should be preserved because fnCaller still points to it
      await ops.removeFileAndCleanup('/src/perf4-callee.ts');

      // File node should be gone
      const afterFile = await client.roQuery<{ count: number }>(
        `MATCH (f:File {filePath: '/src/perf4-callee.ts'}) RETURN count(f) as count`
      );
      expect(afterFile.data[0]?.count).toBe(0);

      // fnCallee should STILL exist (preserved by incoming CALLS edge)
      const afterFn = await client.roQuery<{ count: number }>(
        `MATCH (fn:Function {name: 'fnCallee', filePath: '/src/perf4-callee.ts'}) RETURN count(fn) as count`
      );
      expect(afterFn.data[0]?.count).toBe(1);

      // CALLS edge should still be intact
      const edgeAfter = await client.roQuery<{ count: number }>(
        `MATCH (a:Function {name: 'fnCaller'})-[:CALLS]->(b:Function {name: 'fnCallee'}) RETURN count(*) as count`
      );
      expect(edgeAfter.data[0]?.count).toBe(1);
    });

    it('preserves entities with incoming cross-file EXTENDS edges', async () => {
      // Setup: File A has ClassChild, File B has ClassBase, ClassChild EXTENDS ClassBase
      await ops.upsertFile(makeFile({ path: '/src/perf4-child.ts', name: 'perf4-child.ts' }));
      await ops.upsertClass(makeClass({ name: 'ClassChild', filePath: '/src/perf4-child.ts', startLine: 1 }));

      await ops.upsertFile(makeFile({ path: '/src/perf4-base.ts', name: 'perf4-base.ts' }));
      await ops.upsertClass(makeClass({ name: 'ClassBase', filePath: '/src/perf4-base.ts', startLine: 1 }));

      // Create cross-file EXTENDS edge: ClassChild → ClassBase
      await ops.createExtendsEdge('ClassChild', '/src/perf4-child.ts', 'ClassBase', '/src/perf4-base.ts');

      // Remove the BASE file — ClassBase should be preserved due to incoming EXTENDS
      await ops.removeFileAndCleanup('/src/perf4-base.ts');

      // ClassBase should still exist
      const afterCls = await client.roQuery<{ count: number }>(
        `MATCH (c:Class {name: 'ClassBase', filePath: '/src/perf4-base.ts'}) RETURN count(c) as count`
      );
      expect(afterCls.data[0]?.count).toBe(1);

      // EXTENDS edge should still be intact
      const edgeAfter = await client.roQuery<{ count: number }>(
        `MATCH (a:Class {name: 'ClassChild'})-[:EXTENDS]->(b:Class {name: 'ClassBase'}) RETURN count(*) as count`
      );
      expect(edgeAfter.data[0]?.count).toBe(1);
    });

    it('removes entities from caller file without affecting callee file', async () => {
      // Setup: fnX CALLS fnY (cross-file), then remove the CALLER file
      await ops.upsertFile(makeFile({ path: '/src/perf4-src.ts', name: 'perf4-src.ts' }));
      await ops.upsertFunction(makeFunction({ name: 'fnSrc', filePath: '/src/perf4-src.ts', startLine: 1 }));

      await ops.upsertFile(makeFile({ path: '/src/perf4-dst.ts', name: 'perf4-dst.ts' }));
      await ops.upsertFunction(makeFunction({ name: 'fnDst', filePath: '/src/perf4-dst.ts', startLine: 1 }));

      await ops.createCallEdge('fnSrc', '/src/perf4-src.ts', 'fnDst', '/src/perf4-dst.ts', 10);

      // Remove the CALLER file — fnSrc has no incoming edges, so it should be removed
      await ops.removeFileAndCleanup('/src/perf4-src.ts');

      // fnSrc should be gone (no incoming edges)
      const afterSrc = await client.roQuery<{ count: number }>(
        `MATCH (fn:Function {name: 'fnSrc', filePath: '/src/perf4-src.ts'}) RETURN count(fn) as count`
      );
      expect(afterSrc.data[0]?.count).toBe(0);

      // fnDst should still exist (still contained by its own file)
      const afterDst = await client.roQuery<{ count: number }>(
        `MATCH (fn:Function {name: 'fnDst', filePath: '/src/perf4-dst.ts'}) RETURN count(fn) as count`
      );
      expect(afterDst.data[0]?.count).toBe(1);
    });
  });

  // ==========================================================================
  // clearAll
  // ==========================================================================

  describe('clearAll', () => {
    it('clearAll removes everything from the graph', async () => {
      // Ensure there is data in the graph
      await ops.upsertFile(makeFile({ path: '/src/clear-test.ts', name: 'clear-test.ts' }));
      await ops.upsertFunction(makeFunction({ name: 'clearFn', filePath: '/src/clear-test.ts' }));

      const before = await client.roQuery<{ count: number }>(
        `MATCH (n) RETURN count(n) as count`
      );
      expect(before.data[0]?.count).toBeGreaterThan(0);

      await ops.clearAll();

      const after = await client.roQuery<{ count: number }>(
        `MATCH (n) RETURN count(n) as count`
      );
      expect(after.data[0]?.count).toBe(0);
    });
  });
});

// ============================================================================
// Vector Search Tests
//
// FalkorDB supports creating HNSW indexes first, then adding data with
// vecf32() embeddings. No special ordering needed like Kuzu.
// ============================================================================

describe('Vector Search (FalkorDB)', () => {
  let client: GraphClient;
  let ops: GraphOperations;

  const DIM = 768; // matches EMBEDDING_DIM (nomic-embed-text-v1.5)

  /** Create a simple vector with weight on specific dimensions */
  function makeVec(weights: Record<number, number>): number[] {
    const vec = new Array(DIM).fill(0);
    for (const [idx, val] of Object.entries(weights)) {
      vec[Number(idx)] = val;
    }
    return vec;
  }

  const VECTOR_GRAPH = `test_vec_${Date.now()}`;

  beforeAll(async () => {
    try {
      client = await createClient({
        driver: 'falkordb',
        host: 'localhost',
        port: 6379,
        graphName: VECTOR_GRAPH,
      });
    } catch (error) {
      console.error('FalkorDB not available — skipping tests. Run: docker compose up -d falkordb');
      throw error;
    }

    // Create indexes first (FalkorDB handles this gracefully)
    await client.ensureIndexes();
    ops = createOperations(client);

    // Create nodes and set embeddings
    const filePath = '/src/payments.ts';
    await ops.upsertFile({
      path: filePath, name: 'payments.ts', extension: 'ts',
      loc: 100, lastModified: '2025-01-01T00:00:00Z', hash: 'abc',
    });

    await ops.upsertFunction({
      name: 'processPayment', filePath, startLine: 1, endLine: 10,
      isExported: true, isAsync: true, isArrow: false, params: [],
    });
    await ops.upsertFunction({
      name: 'validateCard', filePath, startLine: 15, endLine: 25,
      isExported: true, isAsync: false, isArrow: false, params: [],
    });
    await ops.upsertFunction({
      name: 'renderChart', filePath, startLine: 30, endLine: 40,
      isExported: true, isAsync: false, isArrow: false, params: [],
    });

    // Set embeddings using vecf32() wrapper (handled by updateEmbedding)
    // paymentVec and cardVec are close together; chartVec is far away
    await ops.updateEmbedding(
      'Function',
      { name: 'processPayment', filePath, startLine: 1 },
      makeVec({ 0: 1.0, 1: 0.0, 2: 0.1 }),
      'hash-payment',
    );
    await ops.updateEmbedding(
      'Function',
      { name: 'validateCard', filePath, startLine: 15 },
      makeVec({ 0: 0.9, 1: 0.1, 2: 0.1 }),
      'hash-card',
    );
    await ops.updateEmbedding(
      'Function',
      { name: 'renderChart', filePath, startLine: 30 },
      makeVec({ 0: 0.1, 1: 0.9, 2: 0.0 }),
      'hash-chart',
    );

    // Set embedding on the File node too
    await ops.updateEmbedding(
      'File',
      { path: filePath },
      makeVec({ 3: 1.0, 4: 0.5 }),
      'hash-file',
    );
  });

  afterAll(async () => {
    try { await client.query(`MATCH (n) DETACH DELETE n`, { params: {} }); } catch { /* best effort */ }
    try { await client.close(); } catch { /* best effort */ }
  });

  it('searchByVector returns Function nodes ranked by similarity', async () => {
    // Query close to processPayment
    const queryVec = makeVec({ 0: 0.95, 1: 0.05, 2: 0.1 });
    const results = await ops.searchByVector('Function', queryVec, 10);

    expect(results.length).toBeGreaterThanOrEqual(3);

    // All results should have distance and nodeType fields
    for (const r of results) {
      expect(typeof r.distance).toBe('number');
      expect(r.nodeType).toBe('Function');
    }

    // All three embedded functions should be found
    const names = results.map(r => r.name);
    expect(names).toContain('processPayment');
    expect(names).toContain('validateCard');
    expect(names).toContain('renderChart');

    // processPayment should be the first result (closest to query)
    expect(results[0]!.name).toBe('processPayment');
    expect(results[0]!.filePath).toBe('/src/payments.ts');
  });

  it('semantic query "payment processing" finds processPayment closest', async () => {
    // Simulate a query vector that's semantically close to "payment"
    const queryVec = makeVec({ 0: 0.8, 1: 0.0, 2: 0.2 });
    const results = await ops.searchByVector('Function', queryVec, 3);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.name).toBe('processPayment');

    // validateCard should be closer than renderChart
    const cardIdx = results.findIndex(r => r.name === 'validateCard');
    const chartIdx = results.findIndex(r => r.name === 'renderChart');
    expect(cardIdx).toBeGreaterThan(-1);
    expect(chartIdx).toBeGreaterThan(-1);
    expect(cardIdx).toBeLessThan(chartIdx);
  });

  it('searchByVector returns startLine for Function nodes', async () => {
    const queryVec = makeVec({ 0: 1.0 });
    const results = await ops.searchByVector('Function', queryVec, 3);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(typeof results[0]!.startLine).toBe('number');
  });

  it('searchByVector works for File nodes', async () => {
    const queryVec = makeVec({ 3: 0.9, 4: 0.6 });
    const results = await ops.searchByVector('File', queryVec, 5);

    expect(results.length).toBeGreaterThanOrEqual(1);
    const match = results.find(r => r.filePath === '/src/payments.ts');
    expect(match).toBeDefined();
    expect(match!.nodeType).toBe('File');
    // File nodes should NOT have startLine
    expect(match!.startLine).toBeUndefined();
  });

  it('searchByVector returns empty array for type with no embeddings', async () => {
    const queryVec = makeVec({ 0: 0.5 });
    const results = await ops.searchByVector('Interface', queryVec, 5);

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });
});

// ============================================================================
// Provenance Stamping Tests
//
// Verifies that provenance fields (sourcePipeline, sourceTask, processedAt)
// are correctly persisted to and read from the graph database.
// ============================================================================

describe('Provenance Stamping (FalkorDB)', () => {
  let client: GraphClient;
  let ops: GraphOperations;

  const PROV_GRAPH = `test_prov_${Date.now()}`;
  const now = new Date().toISOString();

  beforeAll(async () => {
    try {
      client = await createClient({
        driver: 'falkordb',
        host: 'localhost',
        port: 6379,
        graphName: PROV_GRAPH,
      });
    } catch (error) {
      console.error('FalkorDB not available — skipping tests. Run: docker compose up -d falkordb');
      throw error;
    }

    await client.ensureIndexes();
    ops = createOperations(client);
  });

  afterAll(async () => {
    try { await client.query(`MATCH (n) DETACH DELETE n`, { params: {} }); } catch { /* best effort */ }
    try { await client.close(); } catch { /* best effort */ }
  });

  it('upsertFile persists provenance fields', async () => {
    await ops.upsertFile({
      path: '/src/prov-file.ts',
      name: 'prov-file.ts',
      extension: 'ts',
      loc: 50,
      lastModified: now,
      hash: 'prov-hash-1',
      sourcePipeline: 'extract',
      sourceTask: 'parse',
      processedAt: now,
    });

    const result = await client.roQuery<{
      sp: string; st: string; pa: string;
    }>(
      `MATCH (f:File {filePath: '/src/prov-file.ts'})
       RETURN f.sourcePipeline as sp, f.sourceTask as st, f.processedAt as pa`
    );
    expect(result.data[0]?.sp).toBe('extract');
    expect(result.data[0]?.st).toBe('parse');
    expect(result.data[0]?.pa).toBe(now);
  });

  it('upsertFunction persists provenance fields', async () => {
    await ops.upsertFile(makeFile({ path: '/src/prov-fn.ts', name: 'prov-fn.ts' }));
    await ops.upsertFunction({
      name: 'provFn',
      filePath: '/src/prov-fn.ts',
      startLine: 1,
      endLine: 10,
      isExported: true,
      isAsync: false,
      isArrow: false,
      params: [],
      sourcePipeline: 'ingest',
      sourceTask: 'extractEntities',
      processedAt: now,
    });

    const result = await client.roQuery<{
      sp: string; st: string; pa: string;
    }>(
      `MATCH (fn:Function) WHERE fn.name = 'provFn' AND fn.filePath = '/src/prov-fn.ts'
       RETURN fn.sourcePipeline as sp, fn.sourceTask as st, fn.processedAt as pa`
    );
    expect(result.data[0]?.sp).toBe('ingest');
    expect(result.data[0]?.st).toBe('extractEntities');
    expect(result.data[0]?.pa).toBe(now);
  });

  it('upsertClass persists provenance fields', async () => {
    await ops.upsertFile(makeFile({ path: '/src/prov-cls.ts', name: 'prov-cls.ts' }));
    await ops.upsertClass({
      name: 'ProvClass',
      filePath: '/src/prov-cls.ts',
      startLine: 1,
      endLine: 20,
      isExported: true,
      isAbstract: false,
      sourcePipeline: 'embed',
      sourceTask: 'storeGraph',
      processedAt: now,
    });

    const result = await client.roQuery<{
      sp: string; st: string;
    }>(
      `MATCH (c:Class) WHERE c.name = 'ProvClass' AND c.filePath = '/src/prov-cls.ts'
       RETURN c.sourcePipeline as sp, c.sourceTask as st`
    );
    expect(result.data[0]?.sp).toBe('embed');
    expect(result.data[0]?.st).toBe('storeGraph');
  });

  it('entities without provenance have null provenance fields', async () => {
    await ops.upsertFile(makeFile({ path: '/src/prov-null.ts', name: 'prov-null.ts' }));
    await ops.upsertFunction({
      name: 'noProv',
      filePath: '/src/prov-null.ts',
      startLine: 1,
      endLine: 5,
      isExported: false,
      isAsync: false,
      isArrow: false,
      params: [],
    });

    const result = await client.roQuery<{
      sp: unknown; st: unknown;
    }>(
      `MATCH (fn:Function) WHERE fn.name = 'noProv' AND fn.filePath = '/src/prov-null.ts'
       RETURN fn.sourcePipeline as sp, fn.sourceTask as st`
    );
    expect(result.data[0]?.sp).toBeNull();
    expect(result.data[0]?.st).toBeNull();
  });

  it('provenance can be queried across entity types', async () => {
    // Create multiple entities with the same pipeline
    await ops.upsertFile({
      path: '/src/prov-query.ts', name: 'prov-query.ts', extension: 'ts',
      loc: 10, lastModified: now, hash: 'prov-q',
      sourcePipeline: 'test-pipeline', sourceTask: 'parse', processedAt: now,
    });

    await ops.upsertFunction({
      name: 'queryFn', filePath: '/src/prov-query.ts', startLine: 1, endLine: 5,
      isExported: false, isAsync: false, isArrow: false, params: [],
      sourcePipeline: 'test-pipeline', sourceTask: 'extract', processedAt: now,
    });

    await ops.upsertVariable({
      name: 'queryVar', filePath: '/src/prov-query.ts', line: 10,
      kind: 'const', isExported: false,
      sourcePipeline: 'test-pipeline', sourceTask: 'extract', processedAt: now,
    });

    // Query all entities from 'test-pipeline'
    const fnResult = await client.roQuery<{ count: number }>(
      `MATCH (fn:Function) WHERE fn.sourcePipeline = 'test-pipeline' RETURN count(fn) as count`
    );
    expect(fnResult.data[0]?.count).toBeGreaterThanOrEqual(1);

    const varResult = await client.roQuery<{ count: number }>(
      `MATCH (v:Variable) WHERE v.sourcePipeline = 'test-pipeline' RETURN count(v) as count`
    );
    expect(varResult.data[0]?.count).toBeGreaterThanOrEqual(1);

    const fileResult = await client.roQuery<{ count: number }>(
      `MATCH (f:File) WHERE f.sourcePipeline = 'test-pipeline' RETURN count(f) as count`
    );
    expect(fileResult.data[0]?.count).toBeGreaterThanOrEqual(1);
  });

  it('provenance is updated on re-upsert', async () => {
    await ops.upsertFile({
      path: '/src/prov-update.ts', name: 'prov-update.ts', extension: 'ts',
      loc: 10, lastModified: now, hash: 'h1',
      sourcePipeline: 'pipeline-v1', sourceTask: 'task-v1', processedAt: now,
    });

    const updatedAt = new Date().toISOString();
    await ops.upsertFile({
      path: '/src/prov-update.ts', name: 'prov-update.ts', extension: 'ts',
      loc: 20, lastModified: updatedAt, hash: 'h2',
      sourcePipeline: 'pipeline-v2', sourceTask: 'task-v2', processedAt: updatedAt,
    });

    const result = await client.roQuery<{
      sp: string; st: string; pa: string;
    }>(
      `MATCH (f:File {filePath: '/src/prov-update.ts'})
       RETURN f.sourcePipeline as sp, f.sourceTask as st, f.processedAt as pa`
    );
    expect(result.data[0]?.sp).toBe('pipeline-v2');
    expect(result.data[0]?.st).toBe('task-v2');
    expect(result.data[0]?.pa).toBe(updatedAt);
  });
});
