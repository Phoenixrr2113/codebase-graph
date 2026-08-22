import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryParams, QueryResult } from '../client';
import { createClient } from '../client';
import type { DriverConfig } from '../driver';
import { FalkorDBLiteDriver } from '../drivers/falkordblite';
import { createOperations } from '../operations';
import type { ParsedFileEntities } from '../schema';

function findUndefinedPaths(value: unknown, path: string): string[] {
  if (value === undefined) return [path];
  if (value === null || typeof value !== 'object') return [];

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findUndefinedPaths(item, `${path}[${index}]`));
  }

  return Object.entries(value).flatMap(([key, item]) =>
    findUndefinedPaths(item, `${path}.${key}`),
  );
}

function legacyEntities(): ParsedFileEntities {
  return {
    file: {
      path: '/src/legacy-shapes.ts',
      name: 'legacy-shapes.ts',
      extension: 'ts',
      loc: 30,
      lastModified: '2026-08-21T00:00:00.000Z',
      hash: 'legacy-shapes',
    },
    functions: [{
      name: 'legacyFunction', filePath: '/src/legacy-shapes.ts', startLine: 1, endLine: 3,
      isExported: true, isAsync: false, isArrow: false, params: [],
    }],
    classes: [{
      name: 'LegacyClass', filePath: '/src/legacy-shapes.ts', startLine: 5, endLine: 10,
      isExported: true, isAbstract: false,
    }],
    interfaces: [{
      name: 'LegacyInterface', filePath: '/src/legacy-shapes.ts', startLine: 12, endLine: 14,
      isExported: true,
    }],
    variables: [{
      name: 'legacyVariable', filePath: '/src/legacy-shapes.ts', line: 16,
      kind: 'const', isExported: false,
    }],
    types: [{
      name: 'LegacyType', filePath: '/src/legacy-shapes.ts', startLine: 18, endLine: 18,
      isExported: true, kind: 'type',
    }],
    components: [{
      name: 'LegacyComponent', filePath: '/src/legacy-shapes.ts', startLine: 20, endLine: 28,
      isExported: true,
    }],
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
  } as unknown as ParsedFileEntities;
}

describe('graph client query parameter boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replaces undefined values in direct and batched legacy entity writes before the driver receives params', async () => {
    const receivedParams: QueryParams[] = [];

    vi.spyOn(FalkorDBLiteDriver.prototype, 'connect').mockImplementation(
      async (_config: DriverConfig): Promise<void> => {},
    );
    vi.spyOn(FalkorDBLiteDriver.prototype, 'query').mockImplementation(
      async <T>(_cypher: string, params?: QueryParams): Promise<QueryResult<T>> => {
        receivedParams.push(params ?? {});
        return { data: [], metadata: [] };
      },
    );
    vi.spyOn(FalkorDBLiteDriver.prototype, 'close').mockImplementation(
      async (): Promise<void> => {},
    );

    const client = await createClient({ driver: 'falkordblite' });
    const operations = createOperations(client);
    const entities = legacyEntities();

    await operations.batchUpsert(entities);
    await operations.batchUpsertBulk([entities]);
    await client.close();

    const undefinedPaths = receivedParams.flatMap((params, index) =>
      findUndefinedPaths(params, `params[${index}]`),
    );
    const batchedItems = receivedParams.flatMap((params) => {
      const items = params['items'];
      return Array.isArray(items) ? items : [];
    });
    const directSymbolParams = receivedParams.filter((params) => 'scopeKey' in params);
    const batchedSymbolParams = batchedItems.filter((item): item is Record<string, unknown> => (
      typeof item === 'object' && item !== null && 'scopeKey' in item
    ));

    expect(receivedParams.length).toBeGreaterThan(0);
    expect(undefinedPaths).toEqual([]);
    expect(directSymbolParams).toHaveLength(6);
    expect(batchedSymbolParams).toHaveLength(6);
    for (const params of [...directSymbolParams, ...batchedSymbolParams]) {
      expect(params['id']).toMatch(/^sym:v1:[0-9a-f]{64}$/);
      expect(params['scopeKey']).toBe('');
      expect(params['disambiguator']).toBe('');
    }
  });
});
