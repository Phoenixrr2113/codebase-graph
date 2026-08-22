/**
 * Regression tests for the HAS_FILE ordering bug in indexProject().
 *
 * ops.linkProjectFiles() MATCHes the Project node by id (see
 * BATCH_LINK_PROJECT_FILES in packages/graph/src/operations.ts: it uses
 * OPTIONAL MATCH plus a WHERE filter, so a missing Project node just means
 * the MERGE never runs, no error). indexProject() used to call
 * ops.upsertProject() only once, at the very end of indexing, after the
 * per-file chunk loop had already called ops.linkProjectFiles(). Two
 * scenarios were broken:
 *
 *  1. Indexing a brand-new project: the Project node doesn't exist in the
 *     graph at all until the final upsertProject() call, so every
 *     linkProjectFiles() call during the run finds nothing to attach to.
 *  2. A full reindex (force: true) of an existing project: deleteProject()
 *     DETACH DELETEs the Project node, and nothing recreated it before the
 *     chunk loop ran linkProjectFiles() again.
 *
 * These tests mock the pipeline (parsing) and the graph ops layer so they
 * run without tree-sitter or a live FalkorDB, and assert only on call
 * order, which is what the bug actually breaks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GraphClient } from '@codegraph/graph';
import type { ExtractedEntities, FileEntity, ParsedFileEntities, ProjectEntity } from '@codegraph/types';

// ---------------------------------------------------------------------------
// Mocks. vi.mock is hoisted; factory functions must be self-contained, so
// mutable state the factories close over is created via vi.hoisted().
// ---------------------------------------------------------------------------

const opsMocks = vi.hoisted(() => {
  const callOrder: string[] = [];
  return {
    callOrder,
    getProjectByRoot: vi.fn(),
    getProjectFileHashes: vi.fn().mockResolvedValue([]),
    getEmbeddingHashesForFiles: vi.fn().mockResolvedValue(new Map()),
    upsertProject: vi.fn().mockImplementation(async (project: ProjectEntity) => {
      callOrder.push(`upsertProject:${project.id}`);
    }),
    deleteProject: vi.fn().mockImplementation(async (id: string) => {
      callOrder.push(`deleteProject:${id}`);
    }),
    removeFileAndCleanup: vi.fn().mockResolvedValue(undefined),
    removeFileContents: vi.fn().mockResolvedValue(undefined),
    removeDocumentContents: vi.fn().mockResolvedValue(undefined),
    batchUpsertBulk: vi.fn().mockResolvedValue(undefined),
    batchCreateBulk: vi.fn().mockResolvedValue(undefined),
    linkProjectFiles: vi.fn().mockImplementation(async (projectId: string) => {
      callOrder.push(`linkProjectFiles:${projectId}`);
    }),
    linkProjectFile: vi.fn().mockImplementation(async (projectId: string) => {
      callOrder.push(`linkProjectFile:${projectId}`);
    }),
    batchUpsertDocuments: vi.fn().mockResolvedValue(undefined),
  };
});

const gitSyncMock = vi.hoisted(() => vi.fn().mockResolvedValue({
  commitsProcessed: 2,
  edgesCreated: 2,
  lastCommitHash: 'newest',
  totalCommits: 3,
  historyWindowSize: 2,
  historyTruncated: true,
  historyComplete: false,
  durationMs: 1,
  errors: [],
}));

vi.mock('@codegraph/graph', () => ({
  createOperations: vi.fn().mockReturnValue(opsMocks),
}));

vi.mock('../gitSync', () => ({ syncGitHistory: gitSyncMock }));

vi.mock('../pipeline', () => ({
  initParser: vi.fn().mockResolvedValue(undefined),
  parseFile: vi.fn(),
  parseCode: vi.fn().mockReturnValue({ rootNode: {}, sourceCode: '', language: 'typescript' }),
  getLanguageForExtension: vi.fn().mockReturnValue('typescript'),
  createFileEntityFromContent: vi.fn().mockImplementation((filePath: string): FileEntity => ({
    path: filePath,
    name: filePath.split('/').pop() ?? filePath,
    extension: 'ts',
    loc: 1,
    lastModified: new Date().toISOString(),
    hash: 'fakehash',
  })),
  extractEntitiesForFile: vi.fn().mockReturnValue({
    imports: [],
    functions: [],
    classes: [],
    interfaces: [],
    variables: [],
    types: [],
    components: [],
  } satisfies ExtractedEntities),
  buildParsedFileEntities: vi.fn().mockImplementation((file: FileEntity): ParsedFileEntities => ({
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
  })),
  registerPlugins: vi.fn(),
  registerTier2Languages: vi.fn().mockResolvedValue({ registered: [], skipped: [] }),
  buildReExportIndex: vi.fn().mockReturnValue(new Map()),
  countEntities: vi.fn().mockReturnValue(0),
  countEdges: vi.fn().mockReturnValue(0),
  isMarkdownFile: vi.fn().mockReturnValue(false),
  getSupportedExtensions: vi.fn().mockReturnValue(['.ts']),
  DEFAULT_IGNORE_PATTERNS: [],
}));

// Import after mocks are declared.
import { indexProject } from '../indexer';

const fakeClient = {
  graph: null,
  graphName: 'test',
  dialect: {},
  query: vi.fn().mockResolvedValue({ data: [], metadata: [] }),
  roQuery: vi.fn().mockResolvedValue({ data: [], metadata: [] }),
  ensureIndexes: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
} as unknown as GraphClient;

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'codegraph-indexer-link-order-'));
  writeFileSync(join(projectDir, 'foo.ts'), 'export const x = 1;\n');
  opsMocks.callOrder.length = 0;
  opsMocks.getProjectByRoot.mockReset();
  opsMocks.upsertProject.mockClear();
  opsMocks.linkProjectFiles.mockClear();
  opsMocks.deleteProject.mockClear();
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe('indexProject: Project node must exist before linkProjectFiles', () => {
  it('upserts the Project node before linking files for a brand-new project', async () => {
    opsMocks.getProjectByRoot.mockResolvedValue(null);

    const result = await indexProject(projectDir, {
      client: fakeClient,
      includePatterns: ['*.ts'],
      embeddings: false,
      gitSync: false,
      force: false,
    });

    expect(result.success).toBe(true);
    expect(opsMocks.linkProjectFiles).toHaveBeenCalledTimes(1);

    const upsertIdx = opsMocks.callOrder.findIndex((c) => c.startsWith('upsertProject:'));
    const linkIdx = opsMocks.callOrder.findIndex((c) => c.startsWith('linkProjectFiles:'));

    expect(upsertIdx).toBeGreaterThanOrEqual(0);
    expect(linkIdx).toBeGreaterThanOrEqual(0);
    expect(upsertIdx).toBeLessThan(linkIdx);

    // The id used to link files must be the same id that was upserted.
    const linkedProjectId = opsMocks.callOrder[linkIdx]!.split(':')[1];
    const upsertedProjectId = opsMocks.callOrder[upsertIdx]!.split(':')[1];
    expect(linkedProjectId).toBe(upsertedProjectId);
  });

  it('re-upserts the Project node after deleteProject() during a full reindex, before linking files', async () => {
    const existingProject: ProjectEntity = {
      id: randomUUID(),
      name: 'fixture',
      rootPath: projectDir,
      createdAt: new Date().toISOString(),
      lastParsed: new Date().toISOString(),
      fileCount: 1,
    };
    opsMocks.getProjectByRoot.mockResolvedValue(existingProject);

    const result = await indexProject(projectDir, {
      client: fakeClient,
      includePatterns: ['*.ts'],
      embeddings: false,
      gitSync: false,
      force: true,
    });

    expect(result.success).toBe(true);
    expect(opsMocks.deleteProject).toHaveBeenCalledWith(existingProject.id);
    expect(opsMocks.linkProjectFiles).toHaveBeenCalledTimes(1);

    const deleteIdx = opsMocks.callOrder.findIndex((c) => c.startsWith('deleteProject:'));
    const linkIdx = opsMocks.callOrder.findIndex((c) => c.startsWith('linkProjectFiles:'));
    const upsertAfterDeleteIdx = opsMocks.callOrder.findIndex(
      (c, i) => c.startsWith('upsertProject:') && i > deleteIdx,
    );

    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(upsertAfterDeleteIdx).toBeGreaterThan(deleteIdx);
    expect(upsertAfterDeleteIdx).toBeLessThan(linkIdx);
  });

  it('persists git history coverage on the final Project upsert', async () => {
    opsMocks.getProjectByRoot.mockResolvedValue(null);

    const result = await indexProject(projectDir, {
      client: fakeClient,
      includePatterns: ['*.ts'],
      embeddings: false,
      gitSync: true,
    });

    expect(result.success).toBe(true);
    expect(opsMocks.upsertProject).toHaveBeenLastCalledWith(expect.objectContaining({
      gitHistoryTotalCommits: 3,
      gitHistoryWindowSize: 2,
      gitHistoryTruncated: true,
      gitHistoryComplete: false,
    }));
  });
});
