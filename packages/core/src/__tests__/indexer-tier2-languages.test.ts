/**
 * Regression test: registerTier2Languages() had no call site.
 *
 * packages/core/src/pipeline/pipeline.ts exports registerTier2Languages(),
 * which registers the 29 tier-2 tree-sitter languages (Ruby, Kotlin, Swift,
 * C, C++, ...) with the language registry. Nothing in the indexing flow
 * called it, so getSupportedExtensions() (used to build file-discovery glob
 * patterns) never included tier-2 extensions, and those files were never
 * discovered, let alone parsed.
 *
 * These tests mock the pipeline module and the graph ops layer so they run
 * without tree-sitter grammars or a live FalkorDB, and assert only that
 * indexProject()/indexSingleFile() actually call registerTier2Languages(),
 * before file discovery happens.
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

const pipelineMocks = vi.hoisted(() => {
  const callOrder: string[] = [];
  return {
    callOrder,
    registerTier2Languages: vi.fn().mockImplementation(async () => {
      callOrder.push('registerTier2Languages');
      return { registered: [], skipped: [] };
    }),
    getSupportedExtensions: vi.fn().mockImplementation(() => {
      callOrder.push('getSupportedExtensions');
      return ['.ts'];
    }),
  };
});

const opsMocks = vi.hoisted(() => ({
  getProjectByRoot: vi.fn().mockResolvedValue(null),
  getProjectFileHashes: vi.fn().mockResolvedValue([]),
  getEmbeddingHashesForFiles: vi.fn().mockResolvedValue(new Map()),
  upsertProject: vi.fn().mockResolvedValue(undefined),
  deleteProject: vi.fn().mockResolvedValue(undefined),
  removeFileAndCleanup: vi.fn().mockResolvedValue(undefined),
  removeFileContents: vi.fn().mockResolvedValue(undefined),
  removeDocumentContents: vi.fn().mockResolvedValue(undefined),
  batchUpsertBulk: vi.fn().mockResolvedValue(undefined),
  batchCreateBulk: vi.fn().mockResolvedValue(undefined),
  linkProjectFiles: vi.fn().mockResolvedValue(undefined),
  linkProjectFile: vi.fn().mockResolvedValue(undefined),
  batchUpsert: vi.fn().mockResolvedValue(undefined),
  batchUpsertDocuments: vi.fn().mockResolvedValue(undefined),
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
  registerTier2Languages: pipelineMocks.registerTier2Languages,
  buildReExportIndex: vi.fn().mockReturnValue(new Map()),
  countEntities: vi.fn().mockReturnValue(0),
  countEdges: vi.fn().mockReturnValue(0),
  isMarkdownFile: vi.fn().mockReturnValue(false),
  getSupportedExtensions: pipelineMocks.getSupportedExtensions,
  DEFAULT_IGNORE_PATTERNS: [],
}));

// Import after mocks are declared.
import { indexProject, indexSingleFile } from '../indexer';

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
  projectDir = mkdtempSync(join(tmpdir(), 'codegraph-indexer-tier2-'));
  filePath = join(projectDir, 'foo.ts');
  writeFileSync(filePath, 'export const x = 1;\n');
  pipelineMocks.callOrder.length = 0;
  pipelineMocks.registerTier2Languages.mockClear();
  pipelineMocks.getSupportedExtensions.mockClear();
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe('indexProject calls registerTier2Languages before file discovery', () => {
  it('invokes registerTier2Languages, before getSupportedExtensions is used to build discovery patterns', async () => {
    const result = await indexProject(projectDir, {
      client: fakeClient,
      embeddings: false,
      gitSync: false,
    });

    expect(result.success).toBe(true);
    expect(pipelineMocks.registerTier2Languages).toHaveBeenCalledTimes(1);

    const tier2Idx = pipelineMocks.callOrder.indexOf('registerTier2Languages');
    const firstDiscoveryIdx = pipelineMocks.callOrder.indexOf('getSupportedExtensions');

    expect(tier2Idx).toBeGreaterThanOrEqual(0);
    expect(firstDiscoveryIdx).toBeGreaterThanOrEqual(0);
    expect(tier2Idx).toBeLessThan(firstDiscoveryIdx);
  });
});

describe('indexSingleFile calls registerTier2Languages', () => {
  it('invokes registerTier2Languages before parsing the file', async () => {
    const result = await indexSingleFile(filePath, projectDir, fakeClient, false);

    expect(result.success).toBe(true);
    expect(pipelineMocks.registerTier2Languages).toHaveBeenCalledTimes(1);
  });
});
