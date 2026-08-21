import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphOperations } from '@codegraph/graph';
import type { ParsedFileEntities } from '@codegraph/types';
import { buildFunctionEmbeddingText, generateEmbeddings } from '@codegraph/plugin-nlp';
import { embedAllParsedEntities } from '../embed-pass';

vi.mock('@codegraph/plugin-nlp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codegraph/plugin-nlp')>();
  return {
    ...actual,
    isEmbeddingAvailable: () => true,
    generateEmbeddings: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2]] }),
  };
});

const persistedId = `sym:v1:${'a'.repeat(64)}`;
const functionEntity: ParsedFileEntities['functions'][number] = {
  id: persistedId,
  scopeKey: '',
  disambiguator: '',
  name: 'stable',
  filePath: '/project/stable.ts',
  startLine: 80,
  endLine: 84,
  isExported: true,
  isAsync: false,
  isArrow: false,
  params: [],
  returnType: 'number',
  bodySnippet: 'return 1;',
};

const parsed: ParsedFileEntities = {
  file: {
    path: '/project/stable.ts',
    name: 'stable.ts',
    extension: 'ts',
    loc: 84,
    lastModified: new Date(0).toISOString(),
    hash: 'hash',
  },
  functions: [functionEntity],
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

describe('embedding cache identity', () => {
  beforeEach(() => {
    vi.mocked(generateEmbeddings).mockClear();
  });

  it('does not re-embed unchanged content when the same persisted id moves lines', async () => {
    const text = buildFunctionEmbeddingText(functionEntity);
    const hash = createHash('sha256').update(text).digest('hex');
    const ops = {
      getEmbeddingHashesForFiles: vi.fn(),
      batchUpdateEmbeddings: vi.fn(),
      updateEmbedding: vi.fn(),
    } as unknown as GraphOperations;

    const result = await embedAllParsedEntities(
      [parsed],
      ops,
      { provider: 'local' },
      new Map([[persistedId, hash]]),
    );

    expect(result).toMatchObject({ embedded: 0, skipped: 1 });
    expect(generateEmbeddings).not.toHaveBeenCalled();
  });
});
