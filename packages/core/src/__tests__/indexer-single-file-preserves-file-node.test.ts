/**
 * Regression test: indexSingleFile() has the same File-node-destroying bug
 * as indexProject()'s incremental batch path, for the same reason.
 *
 * indexSingleFile() is the code path the file watcher uses for its
 * `onFileChanged` event, which fires for edits to files that already exist
 * in the graph (not just brand-new files: see onFileRemoved in
 * mcp-server/src/index.ts and configureProjects.ts, which is the separate,
 * true-deletion path and still calls removeFileAndCleanup() directly).
 * indexSingleFile() used to call ops.removeFileAndCleanup(filePath) before
 * re-upserting, which would destroy that file's MODIFIED_IN/HAS_FILE edges
 * exactly like the batch path did. It must use ops.removeFileContents()
 * instead, so the File node is refreshed in place rather than rebuilt.
 *
 * This test mocks the pipeline and the graph ops layer (the actual Cypher
 * semantics of removeFileContents() are proven separately, against a real
 * graph, in packages/graph/src/__tests__/remove-file-contents.test.ts and
 * packages/core/src/__tests__/indexer-git-edges-preserved.integration.test.ts)
 * -- this one only checks indexSingleFile() calls the right operation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GraphClient } from '@codegraph/graph';
import type { ExtractedEntities, FileEntity, ParsedFileEntities } from '@codegraph/types';

// ---------------------------------------------------------------------------
// Mocks. vi.mock is hoisted; mutable state the factory closes over must be
// created via vi.hoisted().
// ---------------------------------------------------------------------------

const opsMocks = vi.hoisted(() => ({
  getProjectByRoot: vi.fn().mockResolvedValue(null),
  sweepStaleFileSymbols: vi.fn().mockResolvedValue(undefined),
  removeFileAndCleanup: vi.fn().mockResolvedValue(undefined),
  removeFileContents: vi.fn().mockResolvedValue(undefined),
  removeDocumentContents: vi.fn().mockResolvedValue(undefined),
  batchUpsert: vi.fn().mockResolvedValue(undefined),
  recomputeGraphDegrees: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@codegraph/graph', () => ({
  createOperations: vi.fn().mockReturnValue(opsMocks),
}));

vi.mock('../pipeline', () => ({
  initParser: vi.fn().mockResolvedValue(undefined),
  parseFile: vi.fn().mockResolvedValue({ rootNode: {}, sourceCode: '', language: 'typescript' }),
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
  countEntities: vi.fn().mockReturnValue(0),
  countEdges: vi.fn().mockReturnValue(0),
  isMarkdownFile: vi.fn().mockReturnValue(false),
  getSupportedExtensions: vi.fn().mockReturnValue(['.ts']),
  DEFAULT_IGNORE_PATTERNS: [],
}));

// Import after mocks are declared.
import { indexSingleFile } from '../indexer';

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
let filePath: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'codegraph-single-file-preserve-'));
  filePath = join(projectDir, 'foo.ts');
  writeFileSync(filePath, 'export const x = 1;\n');
  opsMocks.removeFileAndCleanup.mockClear();
  opsMocks.removeFileContents.mockClear();
  opsMocks.sweepStaleFileSymbols.mockClear();
  opsMocks.recomputeGraphDegrees.mockClear();
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe('indexSingleFile: reindexing a changed file must not destroy the File node', () => {
  it('calls removeFileContents (not removeFileAndCleanup) before re-upserting', async () => {
    const result = await indexSingleFile(filePath, projectDir, fakeClient, false);

    expect(result.success).toBe(true);
    expect(opsMocks.removeFileContents).toHaveBeenCalledWith(filePath);
    expect(opsMocks.sweepStaleFileSymbols).toHaveBeenCalledWith(filePath, []);
    expect(opsMocks.recomputeGraphDegrees).toHaveBeenCalledOnce();
    expect(opsMocks.removeFileAndCleanup).not.toHaveBeenCalled();
  });
});
