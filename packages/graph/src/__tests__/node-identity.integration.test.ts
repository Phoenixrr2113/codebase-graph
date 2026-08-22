import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  ClassEntity,
  ComponentEntity,
  ExtractedDocumentEntities,
  FileEntity,
  FunctionEntity,
  InterfaceEntity,
  ParsedFileEntities,
  ProjectEntity,
  TypeEntity,
  VariableEntity,
} from '@codegraph/types';
import { createClient, resolveEmbeddedBinaryPaths, type GraphClient } from '../index';
import { createOperations, type GraphOperations } from '../operations';

const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;
const PROJECT_ID = 'project-node-identity';
const PROJECT_ROOT = '/project';

function symbolId(hex: string): string {
  return `sym:v1:${hex.repeat(64)}`;
}

function makeProject(): ProjectEntity {
  return {
    id: PROJECT_ID,
    name: 'project',
    rootPath: PROJECT_ROOT,
    createdAt: '2026-08-21T00:00:00.000Z',
    lastParsed: '2026-08-21T00:00:00.000Z',
    fileCount: 0,
  };
}

function makeFile(path: string): FileEntity {
  return {
    path,
    name: path.split('/').at(-1) ?? path,
    extension: path.split('.').at(-1) ?? '',
    loc: 20,
    lastModified: '2026-08-21T00:00:00.000Z',
    hash: `hash:${path}`,
  };
}

function makeFunction(id: string, filePath: string, name: string, startLine: number, scopeKey = ''): FunctionEntity {
  return {
    id,
    scopeKey,
    disambiguator: '',
    name,
    filePath,
    startLine,
    endLine: startLine + 2,
    isExported: true,
    isAsync: false,
    isArrow: false,
    params: [],
  };
}

function emptyParsed(path: string): ParsedFileEntities {
  return {
    file: makeFile(path),
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

async function upsertOwnedFile(
  ops: GraphOperations,
  entities: ParsedFileEntities,
  mode: 'single' | 'bulk' | 'fast' = 'bulk',
): Promise<void> {
  if (mode === 'single') await ops.batchUpsert(entities);
  if (mode === 'bulk') await ops.batchUpsertBulk([entities]);
  if (mode === 'fast') await ops.batchCreateBulk([entities]);
  await ops.linkProjectFile(PROJECT_ID, entities.file.path);
}

describeIfAvailable('canonical source identity and project ownership', () => {
  let client: GraphClient;
  let ops: GraphOperations;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'cg-node-identity-'));
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: `node_identity_${Date.now()}`,
    });
    await client.ensureIndexes({ embeddingDim: 8 });
    ops = createOperations(client);
  }, 30_000);

  beforeEach(async () => {
    await client.query('MATCH (n) DETACH DELETE n', { params: {} });
    await ops.upsertProject(makeProject());
  });

  afterAll(async () => {
    if (client) await client.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  }, 15_000);

  it.each(['single', 'bulk'] as const)('%s upsert preserves one node and its inbound edge across a pure line shift', async (mode) => {
    const callerPath = `${PROJECT_ROOT}/caller-${mode}.ts`;
    const targetPath = `${PROJECT_ROOT}/target-${mode}.ts`;
    const callerId = symbolId('a');
    const targetId = symbolId('b');
    const caller = emptyParsed(callerPath);
    caller.functions = [makeFunction(callerId, callerPath, 'caller', 1)];
    const target = emptyParsed(targetPath);
    target.functions = [makeFunction(targetId, targetPath, 'target', 5)];

    await upsertOwnedFile(ops, caller, mode);
    await upsertOwnedFile(ops, target, mode);
    await client.query(
      'MATCH (caller:Function {id: $callerId}), (target:Function {id: $targetId}) CREATE (caller)-[:CALLS]->(target)',
      { params: { callerId, targetId } },
    );
    const before = await client.roQuery<{ internalId: number }>(
      'MATCH (target:Function {id: $targetId}) RETURN id(target) AS internalId',
      { params: { targetId } },
    );

    await ops.removeFileContents(targetPath);
    target.functions = [makeFunction(targetId, targetPath, 'target', 25)];
    await upsertOwnedFile(ops, target, mode);

    const after = await client.roQuery<{ internalId: number; startLine: number; calls: number }>(
      `MATCH (target:Function {id: $targetId})
       OPTIONAL MATCH (:Function {id: $callerId})-[call:CALLS]->(target)
       RETURN id(target) AS internalId, target.startLine AS startLine, count(call) AS calls`,
      { params: { callerId, targetId } },
    );
    expect(after.data).toEqual([{ internalId: before.data[0]!.internalId, startLine: 25, calls: 1 }]);
  });

  it('matches edge descriptor endpoints by canonical id', async () => {
    const filePath = `${PROJECT_ROOT}/edges.ts`;
    const callerId = symbolId('c');
    const calleeId = symbolId('d');
    const parsed = emptyParsed(filePath);
    parsed.functions = [
      makeFunction(callerId, filePath, 'sameName', 1, 'Class:One'),
      makeFunction(calleeId, filePath, 'sameName', 10, 'Class:Two'),
    ];
    parsed.callEdges = [{ callerId, calleeId, line: 3, callerKind: 'Function', via: 'direct' }];

    await upsertOwnedFile(ops, parsed);

    const result = await client.roQuery<{ fromId: string; toId: string }>(
      'MATCH (a)-[:CALLS]->(b) RETURN a.id AS fromId, b.id AS toId',
    );
    expect(result.data).toEqual([{ fromId: callerId, toId: calleeId }]);
  });

  it('uses canonical endpoints for inheritance, render, export, and imported-symbol descriptors', async () => {
    const declarationsPath = `${PROJECT_ROOT}/descriptor-targets.tsx`;
    const importerPath = `${PROJECT_ROOT}/descriptor-importer.ts`;
    const parentId = symbolId('0');
    const childId = symbolId('1');
    const interfaceId = symbolId('2');
    const parentComponentId = symbolId('3');
    const childComponentId = symbolId('4');
    const exportedId = symbolId('5');
    const declarations = emptyParsed(declarationsPath);
    const identity = (id: string) => ({ id, scopeKey: '', disambiguator: '' });
    declarations.classes = [
      { ...identity(parentId), name: 'Parent', filePath: declarationsPath, startLine: 1, endLine: 2, isExported: true, isAbstract: false },
      { ...identity(childId), name: 'Child', filePath: declarationsPath, startLine: 3, endLine: 4, isExported: true, isAbstract: false },
    ];
    declarations.interfaces = [
      { ...identity(interfaceId), name: 'Contract', filePath: declarationsPath, startLine: 5, endLine: 6, isExported: true },
    ];
    declarations.components = [
      { ...identity(parentComponentId), name: 'View', filePath: declarationsPath, startLine: 7, endLine: 8, isExported: true },
      { ...identity(childComponentId), name: 'View', filePath: declarationsPath, startLine: 9, endLine: 10, isExported: true },
    ];
    declarations.functions = [
      makeFunction(exportedId, declarationsPath, 'shared', 11, 'Class:Chosen'),
      makeFunction(symbolId('6'), declarationsPath, 'shared', 15, 'Class:Other'),
    ];
    declarations.extendsEdges = [{ childId, parentId }];
    declarations.implementsEdges = [{ classId: childId, interfaceId }];
    declarations.rendersEdges = [{ parentId: parentComponentId, childId: childComponentId, line: 8 }];
    declarations.exportsEdges = [{
      fromId: `File:${declarationsPath}`,
      toId: exportedId,
      filePath: declarationsPath,
      symbolName: 'shared',
      symbolKind: 'Function',
    }];
    const importer = emptyParsed(importerPath);
    importer.importsSymbolEdges = [{
      fromId: `File:${importerPath}`,
      toId: exportedId,
      fromFilePath: importerPath,
      toFilePath: declarationsPath,
      symbolName: 'shared',
      isDefault: false,
    }];

    await ops.batchUpsertBulk([declarations, importer]);

    const result = await client.roQuery<{ type: string; fromId: string; toId: string }>(
      `MATCH (from)-[r]->(to)
       WHERE type(r) IN ['EXTENDS', 'IMPLEMENTS', 'RENDERS', 'EXPORTS', 'IMPORTS_SYMBOL']
       RETURN type(r) AS type, from.id AS fromId, to.id AS toId
       ORDER BY type`,
    );
    expect(result.data).toEqual([
      { type: 'EXPORTS', fromId: `File:${declarationsPath}`, toId: exportedId },
      { type: 'EXTENDS', fromId: childId, toId: parentId },
      { type: 'IMPLEMENTS', fromId: childId, toId: interfaceId },
      { type: 'IMPORTS_SYMBOL', fromId: `File:${importerPath}`, toId: exportedId },
      { type: 'RENDERS', fromId: parentComponentId, toId: childComponentId },
    ]);
  });

  it('matches single and batch embedding writes by canonical id', async () => {
    const filePath = `${PROJECT_ROOT}/embeddings.ts`;
    const firstId = symbolId('e');
    const secondId = symbolId('f');
    const parsed = emptyParsed(filePath);
    parsed.functions = [
      makeFunction(firstId, filePath, 'duplicate', 1, 'Class:First'),
      makeFunction(secondId, filePath, 'duplicate', 5, 'Class:Second'),
    ];
    await upsertOwnedFile(ops, parsed);

    await ops.updateEmbedding('Function', { id: firstId }, [1, 0], 'first-hash');
    await ops.batchUpdateEmbeddings([{
      nodeType: 'Function',
      identifier: { id: secondId },
      embedding: [0, 1],
      embeddingTextHash: 'second-hash',
    }]);

    const result = await client.roQuery<{ id: string; hash: string }>(
      `MATCH (fn:Function {filePath: $filePath})
       RETURN fn.id AS id, fn.embeddingTextHash AS hash
       ORDER BY id`,
      { params: { filePath } },
    );
    expect(result.data).toEqual([
      { id: firstId, hash: 'first-hash' },
      { id: secondId, hash: 'second-hash' },
    ]);
  });

  it('detach-deletes a deleted or renamed symbol after the current-id upsert', async () => {
    const filePath = `${PROJECT_ROOT}/rename.ts`;
    const oldId = symbolId('1');
    const newId = symbolId('2');
    const parsed = emptyParsed(filePath);
    parsed.functions = [makeFunction(oldId, filePath, 'before', 1)];
    await upsertOwnedFile(ops, parsed);
    await client.query(
      'MATCH (target:Function {id: $oldId}) CREATE (:Entity {name: "inbound"})-[:ABOUT]->(target)',
      { params: { oldId } },
    );
    await client.query(
      'MATCH (:File {filePath: $filePath})-[contains:CONTAINS]->(:Function {id: $oldId}) DELETE contains',
      { params: { filePath, oldId } },
    );

    await ops.removeFileContents(filePath);
    parsed.functions = [makeFunction(newId, filePath, 'after', 1)];
    await upsertOwnedFile(ops, parsed);

    const result = await client.roQuery<{ ids: string[] }>(
      'MATCH (n:Function {filePath: $filePath}) RETURN collect(n.id) AS ids',
      { params: { filePath } },
    );
    expect(result.data[0]!.ids).toEqual([newId]);
  });

  it('keeps same-name members in two classes as distinct nodes on the fast path', async () => {
    const filePath = `${PROJECT_ROOT}/members.ts`;
    const firstId = symbolId('3');
    const secondId = symbolId('4');
    const parsed = emptyParsed(filePath);
    parsed.functions = [
      makeFunction(firstId, filePath, 'work', 2, 'Class:First'),
      makeFunction(secondId, filePath, 'work', 8, 'Class:Second'),
    ];

    await upsertOwnedFile(ops, parsed, 'fast');

    const result = await client.roQuery<{ ids: string[]; scopes: string[] }>(
      `MATCH (fn:Function {filePath: $filePath, name: 'work'})
       RETURN collect(fn.id) AS ids, collect(fn.scopeKey) AS scopes`,
      { params: { filePath } },
    );
    expect(new Set(result.data[0]!.ids)).toEqual(new Set([firstId, secondId]));
    expect(new Set(result.data[0]!.scopes)).toEqual(new Set(['Class:First', 'Class:Second']));
  });

  it('real file deletion detach-deletes every source node even with inbound edges', async () => {
    const filePath = `${PROJECT_ROOT}/deleted.ts`;
    const targetId = symbolId('5');
    const parsed = emptyParsed(filePath);
    parsed.functions = [makeFunction(targetId, filePath, 'deleted', 1)];
    await upsertOwnedFile(ops, parsed);
    await client.query(
      'MATCH (target:Function {id: $targetId}) CREATE (:Entity {name: "inbound"})-[:ABOUT]->(target)',
      { params: { targetId } },
    );

    await ops.removeFileAndCleanup(filePath);

    const result = await client.roQuery<{ count: number }>(
      `MATCH (n) WHERE n.filePath = $filePath AND
       (n:Function OR n:Class OR n:Interface OR n:Variable OR n:Type OR n:Component)
       RETURN count(n) AS count`,
      { params: { filePath } },
    );
    expect(result.data[0]!.count).toBe(0);
  });

  it('force project deletion removes prior source and markdown generations', async () => {
    const filePath = `${PROJECT_ROOT}/old.ts`;
    const parsed = emptyParsed(filePath);
    parsed.functions = [makeFunction(symbolId('6'), filePath, 'old', 1)];
    await upsertOwnedFile(ops, parsed);

    const documentPath = `${PROJECT_ROOT}/README.md`;
    const docs: ExtractedDocumentEntities = {
      document: {
        path: documentPath,
        name: 'README.md',
        title: 'Old',
        frontmatter: {},
        hash: 'old-doc',
        lastModified: '2026-08-21T00:00:00.000Z',
      },
      sections: [{ heading: 'Old', level: 1, filePath: documentPath, startLine: 1, endLine: 4 }],
      codeBlocks: [{ language: 'ts', content: 'old()', filePath: documentPath, startLine: 2, endLine: 3 }],
      links: [{ text: 'old', target: './old.md', isInternal: true, filePath: documentPath, line: 4 }],
      sectionHierarchy: [],
    };
    await ops.batchUpsertDocuments([docs]);
    const ownedBefore = await client.roQuery<{ count: number }>(
      'MATCH (n {projectId: $projectId}) RETURN count(n) AS count',
      { params: { projectId: PROJECT_ID } },
    );
    expect(ownedBefore.data[0]!.count).toBe(7);
    await client.query('MATCH (n {projectId: $projectId}) SET n.indexGeneration = "old"', { params: { projectId: PROJECT_ID } });

    await ops.deleteProject(PROJECT_ID);

    const result = await client.roQuery<{ survivors: number }>(
      'MATCH (n {projectId: $projectId, indexGeneration: "old"}) RETURN count(n) AS survivors',
      { params: { projectId: PROJECT_ID } },
    );
    expect(result.data[0]!.survivors).toBe(0);
    await ops.upsertProject(makeProject());
    await ops.batchUpsertDocuments([{
      ...docs,
      document: { ...docs.document, title: 'New', hash: 'new-doc' },
      sections: [{ heading: 'New', level: 1, filePath: documentPath, startLine: 1, endLine: 1 }],
      codeBlocks: [],
      links: [],
    }]);
    const vanishedMarkdown = await client.roQuery<{ count: number }>(
      `MATCH (n)
       WHERE (n:Section AND n.heading = 'Old') OR n:CodeBlock OR n:Link
       RETURN count(n) AS count`,
    );
    expect(vanishedMarkdown.data[0]!.count).toBe(0);
  });

  it('the three acceptance queries return zero after reconciliation', async () => {
    const filePath = `${PROJECT_ROOT}/acceptance.ts`;
    const parsed = emptyParsed(filePath);
    parsed.functions = [makeFunction(symbolId('7'), filePath, 'accepted', 1)];
    await upsertOwnedFile(ops, parsed);

    const detached = await client.roQuery<{ count: number }>(
      `MATCH (n)
       WHERE n.projectId = $projectId AND
         (n:Function OR n:Class OR n:Interface OR n:Variable OR n:Type OR n:Component)
       OPTIONAL MATCH (f:File)-[:CONTAINS]->(n)
       WITH n, f WHERE f IS NULL
       RETURN count(n) AS count`,
      { params: { projectId: PROJECT_ID } },
    );
    const duplicates = await client.roQuery<{ count: number }>(
      `MATCH (n)
       WHERE n.projectId = $projectId AND
         (n:Function OR n:Class OR n:Interface OR n:Variable OR n:Type OR n:Component)
       WITH labels(n)[0] AS label, n.id AS id, count(*) AS copies
       WHERE copies > 1
       RETURN count(*) AS count`,
      { params: { projectId: PROJECT_ID } },
    );
    const oldGeneration = await client.roQuery<{ count: number }>(
      'MATCH (n {projectId: $projectId, indexGeneration: "old"}) RETURN count(n) AS count',
      { params: { projectId: PROJECT_ID } },
    );
    expect(detached.data[0]!.count).toBe(0);
    expect(duplicates.data[0]!.count).toBe(0);
    expect(oldGeneration.data[0]!.count).toBe(0);
  });

  it.each(['single', 'bulk', 'fast'] as const)('%s writes persist identity fields for all six source labels', async (mode) => {
    const filePath = `${PROJECT_ROOT}/six.tsx`;
    const identity = (id: string, scopeKey = '') => ({ id, scopeKey, disambiguator: '' });
    const parsed = emptyParsed(filePath);
    parsed.functions = [makeFunction(symbolId('8'), filePath, 'fn', 1)];
    parsed.classes = [{ ...identity(symbolId('9')), name: 'Cls', filePath, startLine: 4, endLine: 5, isExported: true, isAbstract: false } satisfies ClassEntity];
    parsed.interfaces = [{ ...identity(symbolId('a'), 'Namespace:X'), name: 'Iface', filePath, startLine: 6, endLine: 7, isExported: true } satisfies InterfaceEntity];
    parsed.variables = [{ ...identity(symbolId('b')), name: 'value', filePath, line: 8, kind: 'const', isExported: true } satisfies VariableEntity];
    parsed.types = [{ ...identity(symbolId('c')), name: 'Alias', filePath, startLine: 9, endLine: 9, isExported: true, kind: 'type' } satisfies TypeEntity];
    parsed.components = [{ ...identity(symbolId('d')), name: 'View', filePath, startLine: 10, endLine: 12, isExported: true } satisfies ComponentEntity];

    await upsertOwnedFile(ops, parsed, mode);

    const result = await client.roQuery<{ count: number }>(
      `MATCH (n {filePath: $filePath})
       WHERE n:Function OR n:Class OR n:Interface OR n:Variable OR n:Type OR n:Component
       WITH n WHERE n.id IS NOT NULL AND n.scopeKey IS NOT NULL AND n.disambiguator IS NOT NULL
       RETURN count(n) AS count`,
      { params: { filePath } },
    );
    expect(result.data[0]!.count).toBe(6);
  });

  it('creates exact-match id indexes for all six source labels', async () => {
    const result = await client.roQuery<{ label: string; properties: string[] }>(
      `CALL db.indexes()
       YIELD label, properties
       WHERE label IN ['Function', 'Class', 'Interface', 'Variable', 'Type', 'Component'] AND 'id' IN properties
       RETURN label, properties`,
    );
    expect(new Set(result.data.map((row) => row.label))).toEqual(
      new Set(['Function', 'Class', 'Interface', 'Variable', 'Type', 'Component']),
    );
  });
});
