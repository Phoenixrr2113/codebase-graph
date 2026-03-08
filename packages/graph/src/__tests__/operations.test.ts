/**
 * Graph CRUD Operations — Integration Tests
 *
 * Tests entity upserts, edge creation, batchUpsert, project operations,
 * and clearAll against a real Kuzu database instance.
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
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

describe('Graph CRUD Operations (Kuzu)', () => {
  let client: GraphClient;
  let ops: GraphOperations;
  let dbPath: string;
  let parentDir: string;

  beforeAll(async () => {
    parentDir = mkdtempSync(join(tmpdir(), 'codegraph-ops-test-'));
    dbPath = join(parentDir, 'kuzu-db');

    client = await createClient({
      driver: 'kuzu',
      databasePath: dbPath,
      graphName: 'test',
    });

    await client.ensureIndexes();
    ops = createOperations(client);
  });

  afterAll(async () => {
    try {
      await client.close();
    } catch {
      // Kuzu SIGSEGV on close is known — ignore
    }
    try {
      rmSync(parentDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  // ==========================================================================
  // File CRUD
  // ==========================================================================

  describe('File CRUD', () => {
    it('upsertFile creates a File node', async () => {
      const file = makeFile({ path: '/src/file-crud-1.ts', name: 'file-crud-1.ts' });
      await ops.upsertFile(file);

      const result = await client.roQuery<{ count: number }>(
        `MATCH (n:File {path: '/src/file-crud-1.ts'}) RETURN count(n) as count`
      );
      expect(result.data[0]?.count).toBe(1);
    });

    it('upsertFile updates properties on re-upsert', async () => {
      const file = makeFile({ path: '/src/file-crud-2.ts', name: 'file-crud-2.ts', loc: 50, hash: 'hash-v1' });
      await ops.upsertFile(file);

      // Update loc and hash
      await ops.upsertFile({ ...file, loc: 200, hash: 'hash-v2' });

      const result = await client.roQuery<{ loc: number; hash: string }>(
        `MATCH (f:File {path: '/src/file-crud-2.ts'}) RETURN f.loc as loc, f.hash as hash`
      );
      expect(result.data[0]?.loc).toBe(200);
      expect(result.data[0]?.hash).toBe('hash-v2');
    });

    it('deleteFileEntities removes file and its children', async () => {
      const file = makeFile({ path: '/src/file-crud-3.ts', name: 'file-crud-3.ts' });
      await ops.upsertFile(file);
      await ops.upsertFunction(makeFunction({ name: 'childFn', filePath: '/src/file-crud-3.ts' }));

      // Verify both exist
      const before = await client.roQuery<{ count: number }>(
        `MATCH (f:File {path: '/src/file-crud-3.ts'}) RETURN count(f) as count`
      );
      expect(before.data[0]?.count).toBe(1);

      await ops.deleteFileEntities('/src/file-crud-3.ts');

      const afterFile = await client.roQuery<{ count: number }>(
        `MATCH (f:File {path: '/src/file-crud-3.ts'}) RETURN count(f) as count`
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
        `MATCH (f:File {path: '/src/entity-fn.ts'})-[r:CONTAINS]->(fn:Function) WHERE fn.name = 'greet' RETURN count(r) as count`
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
        `MATCH (f:File {path: '/src/entity-cls.ts'})-[r:CONTAINS]->(c:Class) WHERE c.name = 'Animal' RETURN count(r) as count`
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
        `MATCH (f:File {path: '/src/entity-iface.ts'})-[r:CONTAINS]->(i:Interface) WHERE i.name = 'Serializable' RETURN count(r) as count`
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
        `MATCH (f:File {path: '/src/entity-var.ts'})-[r:CONTAINS]->(v:Variable) WHERE v.name = 'MAX_SIZE' RETURN count(r) as count`
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
        `MATCH (f:File {path: '/src/entity-comp.tsx'})-[r:CONTAINS]->(comp:Component) WHERE comp.name = 'Button' RETURN count(r) as count`
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
        `MATCH (a:File {path: '/src/edge-imports-from.ts'})-[r:IMPORTS]->(b:File {path: '/src/edge-imports-to.ts'}) RETURN count(r) as count`
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
        `MATCH (f:File {path: '/src/batch-roundtrip.ts'}) RETURN count(f) as count`
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
        `MATCH (f:File {path: '/src/batch-idempotent.ts'}) RETURN count(f) as count`
      );
      expect(fileCount.data[0]?.count).toBe(1);
    });

    it('batchUpsert creates call edges and import edges', async () => {
      // Two files: one imports the other, and has call edges within it
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
        `MATCH (a:File {path: '${filePath}'})-[r:IMPORTS]->(b:File {path: '${importedPath}'}) RETURN count(r) as count`
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
        `MATCH (p:Project {id: 'proj-1'})-[r:HAS_FILE]->(f:File {path: '/src/project-linked.ts'}) RETURN count(r) as count`
      );
      expect(result.data[0]?.count).toBe(1);
    });

    it('deleteProject removes project and cascades to linked files/entities', async () => {
      // Create a project with a linked file and child entity
      await ops.upsertProject({
        id: 'proj-delete-test',
        name: 'delete-me',
        rootPath: '/home/user/delete-me',
        createdAt: now,
        lastParsed: now,
      });

      const file = makeFile({ path: '/src/proj-del-file.ts', name: 'proj-del-file.ts' });
      await ops.upsertFile(file);
      await ops.upsertFunction(makeFunction({ name: 'projDelFn', filePath: '/src/proj-del-file.ts', startLine: 1, endLine: 5 }));
      await ops.linkProjectFile('proj-delete-test', '/src/proj-del-file.ts');

      await ops.deleteProject('proj-delete-test');

      const projectCount = await client.roQuery<{ count: number }>(
        `MATCH (p:Project {id: 'proj-delete-test'}) RETURN count(p) as count`
      );
      expect(projectCount.data[0]?.count).toBe(0);

      // Files and entities linked to the project should be cascade-deleted
      const fileCount = await client.roQuery<{ count: number }>(
        `MATCH (f:File {path: '/src/proj-del-file.ts'}) RETURN count(f) as count`
      );
      expect(fileCount.data[0]?.count).toBe(0);

      const fnCount = await client.roQuery<{ count: number }>(
        `MATCH (fn:Function) WHERE fn.name = 'projDelFn' AND fn.filePath = '/src/proj-del-file.ts' RETURN count(fn) as count`
      );
      expect(fnCount.data[0]?.count).toBe(0);
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
