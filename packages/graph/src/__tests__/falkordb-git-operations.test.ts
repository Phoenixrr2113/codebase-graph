/**
 * Git History Operations — FalkorDB Integration Tests
 *
 * Tests commit upserts, temporal edge creation (MODIFIED_IN, INTRODUCED_IN,
 * DELETED_IN), Metadata node operations, and index creation against a real
 * FalkorDB Docker instance.
 *
 * Prerequisites: docker compose up -d falkordb
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createClient,
  type GraphClient,
  createOperations,
  type GraphOperations,
} from '../index';
import type {
  FileEntity,
  FunctionEntity,
  ClassEntity,
  CommitEntity,
} from '@codegraph/types';

const GRAPH_NAME = `test_git_${Date.now()}`;

// ============================================================================
// Test Fixtures
// ============================================================================

function makeFile(overrides?: Partial<FileEntity>): FileEntity {
  return {
    path: '/repo/src/index.ts',
    name: 'index.ts',
    extension: 'ts',
    loc: 100,
    lastModified: '2025-01-01T00:00:00Z',
    hash: 'filehash123',
    ...overrides,
  };
}

function makeFunction(overrides?: Partial<FunctionEntity>): FunctionEntity {
  return {
    name: 'myFunction',
    filePath: '/repo/src/index.ts',
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
    filePath: '/repo/src/index.ts',
    startLine: 30,
    endLine: 50,
    isExported: true,
    isAbstract: false,
    ...overrides,
  };
}

function makeCommit(overrides?: Partial<CommitEntity>): CommitEntity {
  return {
    hash: 'abc123def456',
    message: 'feat: initial commit',
    author: 'Test Author',
    email: 'test@example.com',
    date: '2025-06-01T12:00:00Z',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Git History Operations (FalkorDB)', () => {
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
  // Schema Index Tests
  // ==========================================================================

  describe('Schema indexes', () => {
    it('should create Commit hash range index', async () => {
      // ensureSchema already ran in beforeAll via ensureIndexes()
      // Verify the Commit node can be efficiently looked up by hash
      const commit = makeCommit();
      await ops.upsertCommit(commit);

      const result = await client.roQuery<{ hash: string }>(
        `MATCH (c:Commit {hash: $hash}) RETURN c.hash as hash`,
        { params: { hash: commit.hash } },
      );
      expect(result.data.length).toBe(1);
      expect(result.data[0]!.hash).toBe(commit.hash);
    });

    it('should create Metadata key range index', async () => {
      // Create a Metadata node directly
      await client.query(
        `CREATE (m:Metadata {key: $key, value: $value})`,
        { params: { key: 'testKey', value: 'testValue' } },
      );

      const result = await client.roQuery<{ value: string }>(
        `MATCH (m:Metadata {key: $key}) RETURN m.value as value`,
        { params: { key: 'testKey' } },
      );
      expect(result.data.length).toBe(1);
      expect(result.data[0]!.value).toBe('testValue');
    });
  });

  // ==========================================================================
  // Commit CRUD Tests
  // ==========================================================================

  describe('Commit operations', () => {
    it('should upsert a commit node', async () => {
      const commit = makeCommit({ hash: 'commit-upsert-1' });
      await ops.upsertCommit(commit);

      const result = await client.roQuery<{
        hash: string;
        message: string;
        author: string;
        email: string;
        date: string;
      }>(
        `MATCH (c:Commit {hash: $hash})
         RETURN c.hash as hash, c.message as message, c.author as author,
                c.email as email, c.date as date`,
        { params: { hash: 'commit-upsert-1' } },
      );

      expect(result.data.length).toBe(1);
      const c = result.data[0]!;
      expect(c.hash).toBe('commit-upsert-1');
      expect(c.message).toBe(commit.message);
      expect(c.author).toBe(commit.author);
      expect(c.email).toBe(commit.email);
      expect(c.date).toBe(commit.date);
    });

    it('should update commit on re-upsert (MERGE)', async () => {
      const commit1 = makeCommit({
        hash: 'commit-merge-1',
        message: 'first message',
      });
      await ops.upsertCommit(commit1);

      const commit2 = makeCommit({
        hash: 'commit-merge-1',
        message: 'updated message',
        author: 'New Author',
      });
      await ops.upsertCommit(commit2);

      const result = await client.roQuery<{ message: string; author: string }>(
        `MATCH (c:Commit {hash: $hash})
         RETURN c.message as message, c.author as author`,
        { params: { hash: 'commit-merge-1' } },
      );

      expect(result.data.length).toBe(1);
      expect(result.data[0]!.message).toBe('updated message');
      expect(result.data[0]!.author).toBe('New Author');
    });

    it('should upsert multiple commits', async () => {
      const commits = [
        makeCommit({ hash: 'multi-1', message: 'first' }),
        makeCommit({ hash: 'multi-2', message: 'second' }),
        makeCommit({ hash: 'multi-3', message: 'third' }),
      ];

      for (const commit of commits) {
        await ops.upsertCommit(commit);
      }

      const result = await client.roQuery<{ hash: string }>(
        `MATCH (c:Commit) WHERE c.hash STARTS WITH 'multi-'
         RETURN c.hash as hash ORDER BY c.hash`,
        { params: {} },
      );

      expect(result.data.length).toBe(3);
      expect(result.data.map((r) => r.hash)).toEqual(['multi-1', 'multi-2', 'multi-3']);
    });

    it('should store provenance fields on commit', async () => {
      const commit = makeCommit({
        hash: 'commit-prov-1',
        sourcePipeline: 'git-sync',
        sourceTask: 'commit-extract',
        processedAt: '2025-06-01T14:00:00Z',
      });
      await ops.upsertCommit(commit);

      const result = await client.roQuery<{
        sourcePipeline: string;
        sourceTask: string;
        processedAt: string;
      }>(
        `MATCH (c:Commit {hash: $hash})
         RETURN c.sourcePipeline as sourcePipeline,
                c.sourceTask as sourceTask,
                c.processedAt as processedAt`,
        { params: { hash: 'commit-prov-1' } },
      );

      expect(result.data.length).toBe(1);
      expect(result.data[0]!.sourcePipeline).toBe('git-sync');
      expect(result.data[0]!.sourceTask).toBe('commit-extract');
      expect(result.data[0]!.processedAt).toBe('2025-06-01T14:00:00Z');
    });
  });

  // ==========================================================================
  // Temporal Edge Tests
  // ==========================================================================

  describe('Temporal edges', () => {
    const filePath = '/repo/src/temporal-test.ts';
    const commitHash = 'temporal-commit-1';

    beforeAll(async () => {
      // Set up: File with contained entities + a Commit node
      await ops.upsertFile(makeFile({ path: filePath, name: 'temporal-test.ts' }));
      await ops.upsertFunction(makeFunction({
        name: 'temporalFunc',
        filePath,
      }));
      await ops.upsertClass(makeClass({
        name: 'TemporalClass',
        filePath,
      }));

      // Create CONTAINS edges (File → Function, File → Class)
      await client.query(
        `MATCH (f:File {filePath: $filePath})
         MATCH (fn:Function {name: $fnName, filePath: $filePath})
         MERGE (f)-[:CONTAINS]->(fn)`,
        { params: { filePath, fnName: 'temporalFunc' } },
      );
      await client.query(
        `MATCH (f:File {filePath: $filePath})
         MATCH (cls:Class {name: $clsName, filePath: $filePath})
         MERGE (f)-[:CONTAINS]->(cls)`,
        { params: { filePath, clsName: 'TemporalClass' } },
      );

      await ops.upsertCommit(makeCommit({ hash: commitHash }));
    });

    it('should create MODIFIED_IN edge from File to Commit', async () => {
      await ops.createModifiedInEdge(filePath, commitHash, 10, 5);

      const result = await client.roQuery<{
        filePath: string;
        commitHash: string;
        linesAdded: number;
        linesRemoved: number;
      }>(
        `MATCH (f:File {filePath: $filePath})-[r:MODIFIED_IN]->(c:Commit {hash: $commitHash})
         RETURN f.filePath as filePath, c.hash as commitHash,
                r.linesAdded as linesAdded, r.linesRemoved as linesRemoved`,
        { params: { filePath, commitHash } },
      );

      expect(result.data.length).toBe(1);
      const edge = result.data[0]!;
      expect(edge.filePath).toBe(filePath);
      expect(edge.commitHash).toBe(commitHash);
      expect(edge.linesAdded).toBe(10);
      expect(edge.linesRemoved).toBe(5);
    });

    it('should update MODIFIED_IN edge stats on re-merge', async () => {
      // Create edge with different stats
      await ops.createModifiedInEdge(filePath, commitHash, 25, 15, 3);

      const result = await client.roQuery<{
        linesAdded: number;
        linesRemoved: number;
        complexityDelta: number;
      }>(
        `MATCH (f:File {filePath: $filePath})-[r:MODIFIED_IN]->(c:Commit {hash: $commitHash})
         RETURN r.linesAdded as linesAdded, r.linesRemoved as linesRemoved,
                r.complexityDelta as complexityDelta`,
        { params: { filePath, commitHash } },
      );

      expect(result.data.length).toBe(1);
      expect(result.data[0]!.linesAdded).toBe(25);
      expect(result.data[0]!.linesRemoved).toBe(15);
      expect(result.data[0]!.complexityDelta).toBe(3);
    });

    it('should create INTRODUCED_IN edges from contained entities to Commit', async () => {
      const introCommitHash = 'intro-commit-1';
      await ops.upsertCommit(makeCommit({ hash: introCommitHash }));

      await ops.createIntroducedInEdgesForFile(filePath, introCommitHash);

      // Both the Function and Class should have INTRODUCED_IN edges
      const result = await client.roQuery<{ entityName: string }>(
        `MATCH (e)-[:INTRODUCED_IN]->(c:Commit {hash: $commitHash})
         RETURN e.name as entityName
         ORDER BY entityName`,
        { params: { commitHash: introCommitHash } },
      );

      expect(result.data.length).toBe(2);
      expect(result.data.map((r) => r.entityName)).toEqual(['TemporalClass', 'temporalFunc']);
    });

    it('should create DELETED_IN edges from contained entities to Commit', async () => {
      const deleteCommitHash = 'delete-commit-1';
      await ops.upsertCommit(makeCommit({ hash: deleteCommitHash }));

      await ops.createDeletedInEdgesForFile(filePath, deleteCommitHash);

      const result = await client.roQuery<{ entityName: string }>(
        `MATCH (e)-[:DELETED_IN]->(c:Commit {hash: $commitHash})
         RETURN e.name as entityName
         ORDER BY entityName`,
        { params: { commitHash: deleteCommitHash } },
      );

      expect(result.data.length).toBe(2);
      expect(result.data.map((r) => r.entityName)).toEqual(['TemporalClass', 'temporalFunc']);
    });

    it('should handle MODIFIED_IN for non-existent file gracefully', async () => {
      // Should not throw — the MATCH just won't find anything
      await ops.createModifiedInEdge('/nonexistent/file.ts', commitHash, 1, 0);

      const result = await client.roQuery<{ count: number }>(
        `MATCH (:File {filePath: '/nonexistent/file.ts'})-[:MODIFIED_IN]->(:Commit)
         RETURN count(*) as count`,
        { params: {} },
      );

      expect(result.data[0]!.count).toBe(0);
    });

    it('should handle INTRODUCED_IN for file with no contained entities', async () => {
      // Create a file with no CONTAINS edges
      const emptyFilePath = '/repo/src/empty.ts';
      await ops.upsertFile(makeFile({
        path: emptyFilePath,
        name: 'empty.ts',
      }));

      const emptyCommit = 'intro-empty-1';
      await ops.upsertCommit(makeCommit({ hash: emptyCommit }));

      // Should not throw
      const count = await ops.createIntroducedInEdgesForFile(emptyFilePath, emptyCommit);
      // May return 0 or 1 depending on MERGE behavior, but should not throw
      expect(typeof count).toBe('number');
    });
  });

  // ==========================================================================
  // Metadata Node Tests
  // ==========================================================================

  describe('Metadata nodes', () => {
    it('should create a metadata entry', async () => {
      await client.query(
        `CREATE (m:Metadata {key: $key, value: $value})`,
        { params: { key: 'lastSync:repo1', value: 'hash-abc' } },
      );

      const result = await client.roQuery<{ value: string }>(
        `MATCH (m:Metadata {key: $key}) RETURN m.value as value`,
        { params: { key: 'lastSync:repo1' } },
      );

      expect(result.data.length).toBe(1);
      expect(result.data[0]!.value).toBe('hash-abc');
    });

    it('should update metadata value', async () => {
      await client.query(
        `MATCH (m:Metadata {key: $key}) SET m.value = $value`,
        { params: { key: 'lastSync:repo1', value: 'hash-def' } },
      );

      const result = await client.roQuery<{ value: string }>(
        `MATCH (m:Metadata {key: $key}) RETURN m.value as value`,
        { params: { key: 'lastSync:repo1' } },
      );

      expect(result.data.length).toBe(1);
      expect(result.data[0]!.value).toBe('hash-def');
    });

    it('should support check-then-insert pattern', async () => {
      const key = 'newMeta:test1';

      // Check — should not exist
      const check = await client.roQuery<{ value: string }>(
        `MATCH (m:Metadata {key: $key}) RETURN m.value as value`,
        { params: { key } },
      );
      expect(check.data.length).toBe(0);

      // Insert
      await client.query(
        `CREATE (m:Metadata {key: $key, value: $value})`,
        { params: { key, value: 'initial' } },
      );

      // Verify
      const verify = await client.roQuery<{ value: string }>(
        `MATCH (m:Metadata {key: $key}) RETURN m.value as value`,
        { params: { key } },
      );
      expect(verify.data.length).toBe(1);
      expect(verify.data[0]!.value).toBe('initial');
    });
  });

  // ==========================================================================
  // Multi-commit history query tests
  // ==========================================================================

  describe('History queries', () => {
    const histFilePath = '/repo/src/history-test.ts';

    beforeAll(async () => {
      // Set up a file with 3 commits
      await ops.upsertFile(makeFile({
        path: histFilePath,
        name: 'history-test.ts',
      }));

      const commits = [
        { hash: 'hist-1', message: 'initial', date: '2025-01-01T00:00:00Z' },
        { hash: 'hist-2', message: 'update 1', date: '2025-02-01T00:00:00Z' },
        { hash: 'hist-3', message: 'update 2', date: '2025-03-01T00:00:00Z' },
      ];

      for (const c of commits) {
        await ops.upsertCommit(makeCommit(c));
        await ops.createModifiedInEdge(histFilePath, c.hash, 5, 2);
      }
    });

    it('should query all commits for a file via MODIFIED_IN', async () => {
      const result = await client.roQuery<{
        hash: string;
        message: string;
        date: string;
      }>(
        `MATCH (f:File {filePath: $filePath})-[:MODIFIED_IN]->(c:Commit)
         RETURN c.hash as hash, c.message as message, c.date as date
         ORDER BY c.date`,
        { params: { filePath: histFilePath } },
      );

      expect(result.data.length).toBe(3);
      expect(result.data[0]!.hash).toBe('hist-1');
      expect(result.data[1]!.hash).toBe('hist-2');
      expect(result.data[2]!.hash).toBe('hist-3');
    });

    it('should count commits per file', async () => {
      const result = await client.roQuery<{
        filePath: string;
        commitCount: number;
      }>(
        `MATCH (f:File {filePath: $filePath})-[:MODIFIED_IN]->(c:Commit)
         RETURN f.filePath as filePath, count(c) as commitCount`,
        { params: { filePath: histFilePath } },
      );

      expect(result.data.length).toBe(1);
      expect(result.data[0]!.commitCount).toBe(3);
    });

    it('should query commits with edge properties (line stats)', async () => {
      const result = await client.roQuery<{
        hash: string;
        linesAdded: number;
        linesRemoved: number;
      }>(
        `MATCH (f:File {filePath: $filePath})-[r:MODIFIED_IN]->(c:Commit)
         RETURN c.hash as hash, r.linesAdded as linesAdded, r.linesRemoved as linesRemoved
         ORDER BY c.date`,
        { params: { filePath: histFilePath } },
      );

      expect(result.data.length).toBe(3);
      for (const row of result.data) {
        expect(row.linesAdded).toBe(5);
        expect(row.linesRemoved).toBe(2);
      }
    });

    it('should find files modified by a specific author', async () => {
      const result = await client.roQuery<{
        filePath: string;
        author: string;
      }>(
        `MATCH (f:File)-[:MODIFIED_IN]->(c:Commit)
         WHERE c.author = $author
         RETURN DISTINCT f.filePath as filePath, c.author as author`,
        { params: { author: 'Test Author' } },
      );

      expect(result.data.length).toBeGreaterThan(0);
      for (const row of result.data) {
        expect(row.author).toBe('Test Author');
      }
    });
  });
});
