/**
 * Barrel re-export chain resolution (Bug 2 in the batch-three fix set, part b),
 * plus the reviewer's round-two follow-ups (blockers 4 and 5):
 *
 *   - `imports.ts` only ever walked `import_statement` nodes, so a barrel file
 *     (`export * from './x'`, `export { y } from './y'`) was invisible to the
 *     extractor. A symbol imported through a barrel resolved to the barrel's
 *     own file path, so CALL edges to that symbol were built against the
 *     barrel (no matching Function node) and silently dropped.
 *   - Blocker 4 (aliased re-exports): the first fix resolved the origin FILE
 *     correctly but kept searching for the callee under the call site's LOCAL
 *     alias, not the name actually declared at the origin
 *     (`export { aliasedFn as renamedFn } from '...'` needs the graph search
 *     to look for `aliasedFn`, not `renamedFn`). `resolveReExportChain` now
 *     returns a `{filePath, exportedName}` pair, not just a file path, and
 *     rewrites `exportedName` at every named-re-export hop.
 *   - Blocker 5 (mixed barrels): a file that BOTH re-exports
 *     (`export * from './other'`) AND declares its own export
 *     (`export function localOnly() {}`) must resolve `localOnly` to itself,
 *     not follow the unrelated star hop. `resolveReExportChain` now takes a
 *     `localExportsByFile` map and checks it before checking re-exports.
 *
 * This covers the chain-following resolver in pipeline.ts (`resolveReExportChain`,
 * `buildResolvedImportMap`) in isolation, plus its wiring into
 * `buildParsedFileEntities` for end-to-end call-edge tests.
 *
 * Barrel resolution is opt-in: it only runs when the caller supplies a
 * `barrelIndex` (and, for the mixed-barrel case, `localExportsIndex`) built
 * from every file's `extractReExports()` / `extractLocalExportedNames()`
 * output ahead of time, which requires a full/batch index. A single-file
 * reindex has no sibling files in memory and simply omits the option, so
 * callee-through-a-barrel stays unresolved there, same as before this fix.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractReExports, extractLocalExportedNames, type ReExportEntity } from '@codegraph/plugin-typescript';
import {
  registerPlugins,
  parseCode,
  extractEntitiesForFile,
  createFileEntityFromContent,
  buildParsedFileEntities,
  buildReExportIndex,
  buildLocalExportsIndex,
  buildResolvedImportMap,
  resolveReExportChain,
} from '../pipeline';
import type { ImportEntity } from '@codegraph/types';
import {
  buildProjectSymbolCatalog,
  resolveProjectSymbolEdges,
} from '../pipeline/pipeline';

describe('resolveReExportChain', () => {
  it('resolves a two-level named re-export chain to the origin file and name', () => {
    const reExportsByFile = new Map<string, ReExportEntity[]>([
      ['/proj/barrel.ts', [{ exportedName: 'foo', source: './mid', sourceResolvedPath: '/proj/mid.ts' }]],
      ['/proj/mid.ts', [{ exportedName: 'foo', source: './origin', sourceResolvedPath: '/proj/origin.ts' }]],
    ]);

    const target = resolveReExportChain('/proj/barrel.ts', 'foo', reExportsByFile);
    expect(target).toEqual({ filePath: '/proj/origin.ts', exportedName: 'foo' });
  });

  it('resolves a two-level star re-export chain to the origin file and name', () => {
    const reExportsByFile = new Map<string, ReExportEntity[]>([
      ['/proj/barrel.ts', [{ exportedName: '*', source: './mid', sourceResolvedPath: '/proj/mid.ts' }]],
      ['/proj/mid.ts', [{ exportedName: '*', source: './origin', sourceResolvedPath: '/proj/origin.ts' }]],
    ]);

    const target = resolveReExportChain('/proj/barrel.ts', 'foo', reExportsByFile);
    expect(target).toEqual({ filePath: '/proj/origin.ts', exportedName: 'foo' });
  });

  describe('reviewer follow-up: multiple `export *` statements in one barrel', () => {
    // A barrel with two SEPARATE `export * from` statements pointing at
    // DIFFERENT, non-colliding modules is the most ordinary index.ts pattern
    // there is. The old implementation's starMatch used
    // reExports.find(r => r.exportedName === '*' && !r.localName), which
    // returns the FIRST star entry regardless of which name is being
    // resolved, so every name silently routed through moduleA.ts even when
    // it was actually declared in moduleB.ts.
    const twoStarReExports = new Map<string, ReExportEntity[]>([
      [
        '/proj/barrel.ts',
        [
          { exportedName: '*', source: './moduleA', sourceResolvedPath: '/proj/moduleA.ts' },
          { exportedName: '*', source: './moduleB', sourceResolvedPath: '/proj/moduleB.ts' },
        ],
      ],
    ]);
    // Definite (non-matching) export surfaces for the two leaf modules, so
    // the resolver can tell "not declared here" apart from "unscanned, no
    // information" -- matches how the real indexer pre-pass populates
    // localExportsIndex for every TypeScript file, not just barrels.
    const twoStarLocalExports = new Map<string, readonly string[]>([
      ['/proj/moduleA.ts', ['fnA']],
      ['/proj/moduleB.ts', ['fnB']],
    ]);

    it('(a) resolves a name declared only in the SECOND star target to that target, not the first', () => {
      const target = resolveReExportChain('/proj/barrel.ts', 'fnB', twoStarReExports, twoStarLocalExports);
      expect(target).toEqual({ filePath: '/proj/moduleB.ts', exportedName: 'fnB' });
    });

    it('(a) resolves a name declared only in the FIRST star target to that target', () => {
      const target = resolveReExportChain('/proj/barrel.ts', 'fnA', twoStarReExports, twoStarLocalExports);
      expect(target).toEqual({ filePath: '/proj/moduleA.ts', exportedName: 'fnA' });
    });

    it('(c) locks the declaration-order tie-break: a name genuinely reachable through BOTH stars resolves to the first-declared one', () => {
      const dupeLocalExports = new Map<string, readonly string[]>([
        ['/proj/moduleA.ts', ['shared']],
        ['/proj/moduleB.ts', ['shared']],
      ]);
      const target = resolveReExportChain('/proj/barrel.ts', 'shared', twoStarReExports, dupeLocalExports);
      expect(target).toEqual({ filePath: '/proj/moduleA.ts', exportedName: 'shared' });
    });

    it('(e) a name declared in neither star target stays unresolved (falls back to the barrel itself)', () => {
      const target = resolveReExportChain('/proj/barrel.ts', 'nowhere', twoStarReExports, twoStarLocalExports);
      // Neither branch resolves it, so the resolver falls back to its
      // best-effort default: the starting file and name, unchanged. This is
      // the same "give up, never guess" fallback used everywhere else in
      // this resolver (e.g. an unresolved external source).
      expect(target).toEqual({ filePath: '/proj/barrel.ts', exportedName: 'nowhere' });
    });

    it('(d) a cycle reachable through one of two star branches still terminates, and the other branch can still resolve', () => {
      // barrel.ts -> [moduleA.ts (leaf), cyclic.ts (star back to barrel.ts)]
      // Chasing a name only moduleA.ts declares must not be defeated by the
      // OTHER branch being a live cycle back to the start file.
      const reExportsByFile = new Map<string, ReExportEntity[]>([
        [
          '/proj/barrel.ts',
          [
            { exportedName: '*', source: './moduleA', sourceResolvedPath: '/proj/moduleA.ts' },
            { exportedName: '*', source: './cyclic', sourceResolvedPath: '/proj/cyclic.ts' },
          ],
        ],
        ['/proj/cyclic.ts', [{ exportedName: '*', source: './barrel', sourceResolvedPath: '/proj/barrel.ts' }]],
      ]);
      const localExportsByFile = new Map<string, readonly string[]>([['/proj/moduleA.ts', ['fnA']]]);

      const target = resolveReExportChain('/proj/barrel.ts', 'fnA', reExportsByFile, localExportsByFile);
      expect(target).toEqual({ filePath: '/proj/moduleA.ts', exportedName: 'fnA' });
    });

    it('(d) a pure two-star mutual cycle terminates without hanging', () => {
      const reExportsByFile = new Map<string, ReExportEntity[]>([
        ['/proj/a.ts', [{ exportedName: '*', source: './b', sourceResolvedPath: '/proj/b.ts' }]],
        ['/proj/b.ts', [{ exportedName: '*', source: './a', sourceResolvedPath: '/proj/a.ts' }]],
      ]);

      const target = resolveReExportChain('/proj/a.ts', 'foo', reExportsByFile);
      expect(typeof target.filePath).toBe('string');
      expect(typeof target.exportedName).toBe('string');
    });
  });

  it('prefers a named re-export over a star re-export at the same hop', () => {
    const reExportsByFile = new Map<string, ReExportEntity[]>([
      [
        '/proj/barrel.ts',
        [
          { exportedName: '*', source: './fallback', sourceResolvedPath: '/proj/fallback.ts' },
          { exportedName: 'foo', source: './origin', sourceResolvedPath: '/proj/origin.ts' },
        ],
      ],
    ]);

    const target = resolveReExportChain('/proj/barrel.ts', 'foo', reExportsByFile);
    expect(target).toEqual({ filePath: '/proj/origin.ts', exportedName: 'foo' });
  });

  it('reviewer blocker 4: a single-hop aliased re-export resolves to the origin-declared name, not the local alias', () => {
    // export { aliasedFn as renamedFn } from './origin' -- a consumer calling
    // renamedFn() must search for aliasedFn at origin.ts, since that's the
    // name the real Function node there actually has.
    const reExportsByFile = new Map<string, ReExportEntity[]>([
      ['/proj/aliasBarrel.ts', [{ exportedName: 'aliasedFn', localName: 'renamedFn', source: './origin', sourceResolvedPath: '/proj/origin.ts' }]],
    ]);

    const target = resolveReExportChain('/proj/aliasBarrel.ts', 'renamedFn', reExportsByFile);
    expect(target).toEqual({ filePath: '/proj/origin.ts', exportedName: 'aliasedFn' });
  });

  it('reviewer blocker 4: a two-hop chain with an alias on the second hop resolves to the origin-declared name', () => {
    // consumer -> barrel1 (star) -> barrel2 (named + aliased) -> origin
    const reExportsByFile = new Map<string, ReExportEntity[]>([
      ['/proj/barrel1.ts', [{ exportedName: '*', source: './barrel2', sourceResolvedPath: '/proj/barrel2.ts' }]],
      ['/proj/barrel2.ts', [{ exportedName: 'aliasedFn', localName: 'exportedAliasedFn', source: './origin', sourceResolvedPath: '/proj/origin.ts' }]],
    ]);

    const target = resolveReExportChain('/proj/barrel1.ts', 'exportedAliasedFn', reExportsByFile);
    expect(target).toEqual({ filePath: '/proj/origin.ts', exportedName: 'aliasedFn' });
  });

  it('reviewer blocker 5: a mixed barrel resolves its own locally declared export to itself, not an unrelated star re-export', () => {
    // mixedBarrel.ts does `export * from './otherThing'` AND declares its own
    // `export function localOnly() {}`. Importing `localOnly` from
    // mixedBarrel.ts must resolve to mixedBarrel.ts itself.
    const reExportsByFile = new Map<string, ReExportEntity[]>([
      ['/proj/mixedBarrel.ts', [{ exportedName: '*', source: './otherThing', sourceResolvedPath: '/proj/otherThing.ts' }]],
    ]);
    const localExportsByFile = new Map<string, readonly string[]>([
      ['/proj/mixedBarrel.ts', ['localOnly']],
    ]);

    const target = resolveReExportChain('/proj/mixedBarrel.ts', 'localOnly', reExportsByFile, localExportsByFile);
    expect(target).toEqual({ filePath: '/proj/mixedBarrel.ts', exportedName: 'localOnly' });
  });

  it('a mixed barrel still follows its star re-export for a name it does NOT declare locally', () => {
    const reExportsByFile = new Map<string, ReExportEntity[]>([
      ['/proj/mixedBarrel.ts', [{ exportedName: '*', source: './otherThing', sourceResolvedPath: '/proj/otherThing.ts' }]],
    ]);
    const localExportsByFile = new Map<string, readonly string[]>([
      ['/proj/mixedBarrel.ts', ['localOnly']],
    ]);

    const target = resolveReExportChain('/proj/mixedBarrel.ts', 'otherThingFn', reExportsByFile, localExportsByFile);
    expect(target).toEqual({ filePath: '/proj/otherThing.ts', exportedName: 'otherThingFn' });
  });

  it('terminates on a re-export cycle instead of looping forever', () => {
    const reExportsByFile = new Map<string, ReExportEntity[]>([
      ['/proj/a.ts', [{ exportedName: '*', source: './b', sourceResolvedPath: '/proj/b.ts' }]],
      ['/proj/b.ts', [{ exportedName: '*', source: './a', sourceResolvedPath: '/proj/a.ts' }]],
    ]);

    // The important property under test is that this call returns at all
    // (a naive implementation without a visited-set would loop forever).
    const target = resolveReExportChain('/proj/a.ts', 'foo', reExportsByFile);
    expect(typeof target.filePath).toBe('string');
    expect(typeof target.exportedName).toBe('string');
  });

  it('returns the starting file and name unchanged when it is not a barrel', () => {
    const reExportsByFile = new Map<string, ReExportEntity[]>();
    const target = resolveReExportChain('/proj/plain.ts', 'foo', reExportsByFile);
    expect(target).toEqual({ filePath: '/proj/plain.ts', exportedName: 'foo' });
  });

  it('stops at a barrel hop whose source is unresolved (external)', () => {
    const reExportsByFile = new Map<string, ReExportEntity[]>([
      ['/proj/barrel.ts', [{ exportedName: 'foo', source: 'some-external-pkg' }]],
    ]);

    const target = resolveReExportChain('/proj/barrel.ts', 'foo', reExportsByFile);
    expect(target).toEqual({ filePath: '/proj/barrel.ts', exportedName: 'foo' });
  });
});

describe('buildReExportIndex', () => {
  it('omits files with no re-exports', () => {
    const index = buildReExportIndex([
      { filePath: '/proj/barrel.ts', reExports: [{ exportedName: 'foo', source: './x', sourceResolvedPath: '/proj/x.ts' }] },
      { filePath: '/proj/plain.ts', reExports: [] },
    ]);

    expect(index.has('/proj/barrel.ts')).toBe(true);
    expect(index.has('/proj/plain.ts')).toBe(false);
  });
});

describe('buildLocalExportsIndex', () => {
  it('omits files with no local exports', () => {
    const index = buildLocalExportsIndex([
      { filePath: '/proj/mixedBarrel.ts', names: ['localOnly'] },
      { filePath: '/proj/pureBarrel.ts', names: [] },
    ]);

    expect(index.get('/proj/mixedBarrel.ts')).toEqual(['localOnly']);
    expect(index.has('/proj/pureBarrel.ts')).toBe(false);
  });
});

describe('buildResolvedImportMap', () => {
  function makeImport(overrides: Partial<ImportEntity>): ImportEntity {
    return {
      id: 'imp',
      source: './x',
      filePath: '/proj/app.ts',
      isDefault: false,
      isNamespace: false,
      specifiers: [],
      ...overrides,
    };
  }

  it('resolves an aliased named specifier to its origin-declared name', () => {
    // aliasBarrel.ts does `export { aliasedFn as renamedFn } from './origin'`,
    // so a consumer importing from aliasBarrel.ts sees a symbol literally
    // named `renamedFn` (no import-side alias of its own): the barrel's own
    // rename already happened, `renamedFn` IS what the barrel calls it.
    const reExportsByFile = new Map<string, ReExportEntity[]>([
      ['/proj/aliasBarrel.ts', [{ exportedName: 'aliasedFn', localName: 'renamedFn', source: './origin', sourceResolvedPath: '/proj/origin.ts' }]],
    ]);
    const imports = [
      makeImport({ resolvedPath: '/proj/aliasBarrel.ts', specifiers: [{ name: 'renamedFn' }] }),
    ];

    const map = buildResolvedImportMap(imports, reExportsByFile);
    expect(map.get('renamedFn')).toEqual({ filePath: '/proj/origin.ts', exportedName: 'aliasedFn' });
  });

  it('resolves a default import through resolveReExportChain using the "default" symbol name', () => {
    // barrel.ts does `export { default } from './origin'` (no rename): its
    // own default export forwards origin's default as-is.
    const reExportsByFile = new Map<string, ReExportEntity[]>([
      ['/proj/barrel.ts', [{ exportedName: 'default', source: './origin', sourceResolvedPath: '/proj/origin.ts' }]],
    ]);
    const imports = [
      makeImport({ resolvedPath: '/proj/barrel.ts', isDefault: true, defaultAlias: 'X', specifiers: [] }),
    ];

    const map = buildResolvedImportMap(imports, reExportsByFile);
    expect(map.get('X')).toEqual({ filePath: '/proj/origin.ts', exportedName: 'default' });
  });

  it('reduces to identity for a plain non-barrel import (no reExportsByFile entry)', () => {
    const imports = [
      makeImport({ resolvedPath: '/proj/worker.ts', specifiers: [{ name: 'doWork' }] }),
    ];

    const map = buildResolvedImportMap(imports, new Map());
    expect(map.get('doWork')).toEqual({ filePath: '/proj/worker.ts', exportedName: 'doWork' });
  });

  it('skips unresolved (external) imports', () => {
    const imports = [makeImport({ specifiers: [{ name: 'lodash' }] })]; // no resolvedPath
    const map = buildResolvedImportMap(imports, new Map());
    expect(map.has('lodash')).toBe(false);
  });
});

describe('buildParsedFileEntities: barrel-aware CALL edges (end-to-end)', () => {
  let dir: string;

  beforeAll(() => {
    registerPlugins();
    dir = mkdtempSync(join(tmpdir(), 'barrel-pipeline-test-'));
    writeFileSync(
      join(dir, 'service.ts'),
      'export class Service {\n  method() {}\n}\n',
    );
    writeFileSync(join(dir, 'mid.ts'), "export { Service } from './service';\n");
    writeFileSync(join(dir, 'barrel.ts'), "export { Service } from './mid';\n");
    writeFileSync(
      join(dir, 'main.ts'),
      [
        "import { Service } from './barrel';",
        '',
        'function run() {',
        '  const s = new Service();',
        '  s.method();',
        '}',
        '',
      ].join('\n'),
    );

    // --- Blocker 4 fixture: aliased re-export ---
    writeFileSync(join(dir, 'origin.ts'), 'export function aliasedFn(): string {\n  return "aliased-origin";\n}\n');
    writeFileSync(join(dir, 'aliasBarrel.ts'), "export { aliasedFn as renamedFn } from './origin';\n");
    writeFileSync(
      join(dir, 'aliasConsumer.ts'),
      [
        "import { renamedFn } from './aliasBarrel';",
        '',
        'export function useAlias(): void {',
        '  renamedFn();',
        '}',
        '',
      ].join('\n'),
    );

    // --- Blocker 5 fixture: mixed barrel ---
    writeFileSync(join(dir, 'otherThing.ts'), 'export function otherThingFn(): string {\n  return "other-thing";\n}\n');
    writeFileSync(
      join(dir, 'mixedBarrel.ts'),
      "export * from './otherThing';\n\nexport function localOnly(): string {\n  return 'local-only';\n}\n",
    );
    writeFileSync(
      join(dir, 'mixedConsumer.ts'),
      [
        "import { localOnly } from './mixedBarrel';",
        '',
        'export function useMixed(): void {',
        '  localOnly();',
        '}',
        '',
      ].join('\n'),
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function parseAndExtract(filePath: string) {
    const content = readFileSync(filePath, 'utf-8');
    const syntaxTree = parseCode(content, 'typescript', '.ts');
    const extracted = extractEntitiesForFile(syntaxTree.rootNode, filePath);
    const fileEntity = createFileEntityFromContent(filePath, content, new Date());
    return { rootNode: syntaxTree.rootNode, extracted, fileEntity, content };
  }

  it('without a barrelIndex, the receiver call resolves to the barrel (unresolved origin)', () => {
    const main = parseAndExtract(join(dir, 'main.ts'));
    const built = buildParsedFileEntities(
      main.fileEntity,
      main.extracted,
      main.rootNode,
      { deepAnalysis: true, includeExternals: false },
    );
    resolveProjectSymbolEdges([built], buildProjectSymbolCatalog([built]));

    const callerId = built.functions.find((fn) => fn.name === 'run')?.id;
    expect(built.callEdges.find((edge) => edge.callerId === callerId)).toBeUndefined();
  });

  it('with a barrelIndex, the receiver call resolves through the two-level barrel chain to service.ts', () => {
    const service = parseAndExtract(join(dir, 'service.ts'));
    const mid = parseAndExtract(join(dir, 'mid.ts'));
    const barrel = parseAndExtract(join(dir, 'barrel.ts'));
    const main = parseAndExtract(join(dir, 'main.ts'));

    const barrelIndex = buildReExportIndex([
      { filePath: join(dir, 'mid.ts'), reExports: extractReExports(mid.rootNode, join(dir, 'mid.ts')) },
      { filePath: join(dir, 'barrel.ts'), reExports: extractReExports(barrel.rootNode, join(dir, 'barrel.ts')) },
      { filePath: join(dir, 'service.ts'), reExports: extractReExports(service.rootNode, join(dir, 'service.ts')) },
    ]);

    const built = buildParsedFileEntities(
      main.fileEntity,
      main.extracted,
      main.rootNode,
      { deepAnalysis: true, includeExternals: false, barrelIndex },
    );
    const serviceBuilt = buildParsedFileEntities(
      service.fileEntity,
      service.extracted,
      service.rootNode,
      { deepAnalysis: true, includeExternals: false, barrelIndex },
    );
    const files = [built, serviceBuilt];
    resolveProjectSymbolEdges(files, buildProjectSymbolCatalog(files));

    const callerId = built.functions.find((fn) => fn.name === 'run')?.id;
    const methodCall = built.callEdges.find((edge) => edge.callerId === callerId);
    expect(methodCall).toBeDefined();
    expect(methodCall!.calleeId).toBe(serviceBuilt.functions.find((fn) => fn.name === 'method')?.id);

    // The File-to-File IMPORTS edge stays pointing at the barrel: that edge
    // describes what main.ts actually imports from, which is genuinely the
    // barrel, not service.ts.
    const importEdge = built.importsEdges.find((e) => e.fromFilePath === join(dir, 'main.ts'));
    expect(importEdge?.toFilePath).toBe(join(dir, 'barrel.ts'));
  });

  it('reviewer blocker 4 (end-to-end): an aliased re-export CALLS edge resolves to the origin file under the origin-declared name', () => {
    const origin = parseAndExtract(join(dir, 'origin.ts'));
    const aliasBarrel = parseAndExtract(join(dir, 'aliasBarrel.ts'));
    const consumer = parseAndExtract(join(dir, 'aliasConsumer.ts'));

    const barrelIndex = buildReExportIndex([
      { filePath: join(dir, 'aliasBarrel.ts'), reExports: extractReExports(aliasBarrel.rootNode, join(dir, 'aliasBarrel.ts')) },
      { filePath: join(dir, 'origin.ts'), reExports: extractReExports(origin.rootNode, join(dir, 'origin.ts')) },
    ]);

    const built = buildParsedFileEntities(
      consumer.fileEntity,
      consumer.extracted,
      consumer.rootNode,
      { deepAnalysis: true, includeExternals: false, barrelIndex },
    );
    const originBuilt = buildParsedFileEntities(
      origin.fileEntity,
      origin.extracted,
      origin.rootNode,
      { deepAnalysis: true, includeExternals: false, barrelIndex },
    );
    const files = [built, originBuilt];
    resolveProjectSymbolEdges(files, buildProjectSymbolCatalog(files));

    const callerId = built.functions.find((fn) => fn.name === 'useAlias')?.id;
    const call = built.callEdges.find((edge) => edge.callerId === callerId);
    expect(call).toBeDefined();
    // The real Function node at origin.ts is named aliasedFn, not renamedFn
    // (the call site's local alias). The callee id must search for the
    // origin-declared name, or this edge silently drops at graph-write time.
    expect(call!.calleeId).toBe(originBuilt.functions.find((fn) => fn.name === 'aliasedFn')?.id);
  });

  it('reviewer blocker 5 (end-to-end): a mixed barrel resolves its own local export to itself, not the unrelated star target', () => {
    const otherThing = parseAndExtract(join(dir, 'otherThing.ts'));
    const mixedBarrel = parseAndExtract(join(dir, 'mixedBarrel.ts'));
    const consumer = parseAndExtract(join(dir, 'mixedConsumer.ts'));

    const barrelIndex = buildReExportIndex([
      { filePath: join(dir, 'mixedBarrel.ts'), reExports: extractReExports(mixedBarrel.rootNode, join(dir, 'mixedBarrel.ts')) },
      { filePath: join(dir, 'otherThing.ts'), reExports: extractReExports(otherThing.rootNode, join(dir, 'otherThing.ts')) },
    ]);
    const localExportsIndex = buildLocalExportsIndex([
      { filePath: join(dir, 'mixedBarrel.ts'), names: extractLocalExportedNames(mixedBarrel.rootNode, join(dir, 'mixedBarrel.ts')) },
    ]);

    const built = buildParsedFileEntities(
      consumer.fileEntity,
      consumer.extracted,
      consumer.rootNode,
      { deepAnalysis: true, includeExternals: false, barrelIndex, localExportsIndex },
    );
    const targetBuilt = buildParsedFileEntities(
      mixedBarrel.fileEntity,
      mixedBarrel.extracted,
      mixedBarrel.rootNode,
      { deepAnalysis: true, includeExternals: false, barrelIndex, localExportsIndex },
    );
    const files = [built, targetBuilt];
    resolveProjectSymbolEdges(files, buildProjectSymbolCatalog(files));

    const callerId = built.functions.find((fn) => fn.name === 'useMixed')?.id;
    const call = built.callEdges.find((edge) => edge.callerId === callerId);
    expect(call).toBeDefined();
    expect(call!.calleeId).toBe(targetBuilt.functions.find((fn) => fn.name === 'localOnly')?.id);
  });

  it('without localExportsIndex, the mixed-barrel local export can be mis-resolved through the unrelated star hop (documents the degraded case)', () => {
    const otherThing = parseAndExtract(join(dir, 'otherThing.ts'));
    const mixedBarrel = parseAndExtract(join(dir, 'mixedBarrel.ts'));
    const consumer = parseAndExtract(join(dir, 'mixedConsumer.ts'));

    const barrelIndex = buildReExportIndex([
      { filePath: join(dir, 'mixedBarrel.ts'), reExports: extractReExports(mixedBarrel.rootNode, join(dir, 'mixedBarrel.ts')) },
      { filePath: join(dir, 'otherThing.ts'), reExports: extractReExports(otherThing.rootNode, join(dir, 'otherThing.ts')) },
    ]);

    // localExportsIndex intentionally omitted.
    const built = buildParsedFileEntities(
      consumer.fileEntity,
      consumer.extracted,
      consumer.rootNode,
      { deepAnalysis: true, includeExternals: false, barrelIndex },
    );
    const files = [built];
    resolveProjectSymbolEdges(files, buildProjectSymbolCatalog(files));

    const callerId = built.functions.find((fn) => fn.name === 'useMixed')?.id;
    expect(built.callEdges.find((edge) => edge.callerId === callerId)).toBeUndefined();
  });
});

describe('buildParsedFileEntities: barrel-aware TypeRefs (reviewer follow-up blocker 1)', () => {
  // Mirrors the reviewer's attack-a fixture-a/viaBarrel.ts scenario exactly:
  // types.ts declares User, barrel.ts re-exports it, viaBarrel.ts imports
  // User from the barrel and uses it in a function signature (both param and
  // return type). The TypeRef for User must key on types.ts (where User is
  // actually declared), not barrel.ts (where it merely passes through) --
  // otherwise the same type imported directly (a.ts) vs. through the barrel
  // (viaBarrel.ts) produces two different TypeRef nodes instead of collapsing
  // onto one, breaking "find everywhere User is used" queries.
  let dir: string;

  beforeAll(() => {
    registerPlugins();
    dir = mkdtempSync(join(tmpdir(), 'barrel-typeref-test-'));
    writeFileSync(
      join(dir, 'types.ts'),
      'export interface User {\n  id: string;\n  name: string;\n}\n',
    );
    writeFileSync(join(dir, 'barrel.ts'), "export { User } from './types';\n");
    writeFileSync(
      join(dir, 'viaBarrel.ts'),
      [
        "import { User } from './barrel';",
        '',
        'export function fromBarrel(u: User): User {',
        '  return u;',
        '}',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'directImport.ts'),
      [
        "import { User } from './types';",
        '',
        'export function fromDirect(u: User): User {',
        '  return u;',
        '}',
        '',
      ].join('\n'),
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function parseAndExtract(filePath: string) {
    const content = readFileSync(filePath, 'utf-8');
    const syntaxTree = parseCode(content, 'typescript', '.ts');
    const extracted = extractEntitiesForFile(syntaxTree.rootNode, filePath);
    const fileEntity = createFileEntityFromContent(filePath, content, new Date());
    return { rootNode: syntaxTree.rootNode, extracted, fileEntity, content };
  }

  it('with a barrelIndex, the User TypeRef keys on types.ts (the declaring file), not barrel.ts', () => {
    const types = parseAndExtract(join(dir, 'types.ts'));
    const barrel = parseAndExtract(join(dir, 'barrel.ts'));
    const viaBarrel = parseAndExtract(join(dir, 'viaBarrel.ts'));

    const barrelIndex = buildReExportIndex([
      { filePath: join(dir, 'barrel.ts'), reExports: extractReExports(barrel.rootNode, join(dir, 'barrel.ts')) },
    ]);

    const built = buildParsedFileEntities(
      viaBarrel.fileEntity,
      viaBarrel.extracted,
      viaBarrel.rootNode,
      { deepAnalysis: true, includeExternals: false, barrelIndex },
    );

    const userRef = built.typeRefs.find((t) => t.name === 'User');
    expect(userRef).toBeDefined();
    expect(userRef!.definingFile).toBe(join(dir, 'types.ts'));
    expect(userRef!.id).toBe(`type::typescript::${join(dir, 'types.ts')}::User`);

    // And it must NOT have collapsed onto the barrel file instead.
    expect(userRef!.definingFile).not.toBe(join(dir, 'barrel.ts'));
  });

  it('without a barrelIndex, the User TypeRef keys on barrel.ts (documents the pre-fix/unresolved case)', () => {
    const viaBarrel = parseAndExtract(join(dir, 'viaBarrel.ts'));

    const built = buildParsedFileEntities(
      viaBarrel.fileEntity,
      viaBarrel.extracted,
      viaBarrel.rootNode,
      { deepAnalysis: true, includeExternals: false },
    );

    const userRef = built.typeRefs.find((t) => t.name === 'User');
    expect(userRef).toBeDefined();
    expect(userRef!.definingFile).toBe(join(dir, 'barrel.ts'));
  });

  it('a direct import and a barrel-routed import of the same type collapse onto one TypeRef id', () => {
    const barrel = parseAndExtract(join(dir, 'barrel.ts'));
    const viaBarrel = parseAndExtract(join(dir, 'viaBarrel.ts'));
    const direct = parseAndExtract(join(dir, 'directImport.ts'));

    const barrelIndex = buildReExportIndex([
      { filePath: join(dir, 'barrel.ts'), reExports: extractReExports(barrel.rootNode, join(dir, 'barrel.ts')) },
    ]);

    const builtViaBarrel = buildParsedFileEntities(
      viaBarrel.fileEntity, viaBarrel.extracted, viaBarrel.rootNode,
      { deepAnalysis: true, includeExternals: false, barrelIndex },
    );
    // Direct import needs no barrelIndex at all: types.ts isn't a barrel.
    const builtDirect = buildParsedFileEntities(
      direct.fileEntity, direct.extracted, direct.rootNode,
      { deepAnalysis: true, includeExternals: false },
    );

    const viaBarrelUserRef = builtViaBarrel.typeRefs.find((t) => t.name === 'User');
    const directUserRef = builtDirect.typeRefs.find((t) => t.name === 'User');
    expect(viaBarrelUserRef).toBeDefined();
    expect(directUserRef).toBeDefined();
    // Same id means the graph MERGEs these onto one TypeRef node: a "find
    // everywhere User is used" query sees both fromBarrel and fromDirect,
    // instead of the barrel-routed usage silently landing on a second,
    // barrel-keyed node that a query starting from types.ts never reaches.
    expect(viaBarrelUserRef!.id).toBe(directUserRef!.id);
  });
});

describe('buildParsedFileEntities: multi-star barrel end-to-end (reviewer follow-up)', () => {
  // Mirrors the reviewer's fixture-e exactly:
  //   multiStarBarrel.ts:      export * from './moduleA'; export * from './moduleB';
  //   multiStarConsumer.ts:    import { fnA, fnB } from './multiStarBarrel'; calls both.
  //   multiStarTypeBarrel.ts:  export * from './typeA'; export * from './typeB';
  //   multiStarTypeConsumer.ts: import { TypeA, TypeB } from './multiStarTypeBarrel';
  //                             uses both in one function's parameters.
  let dir: string;

  beforeAll(() => {
    registerPlugins();
    dir = mkdtempSync(join(tmpdir(), 'barrel-multistar-test-'));
    writeFileSync(join(dir, 'moduleA.ts'), "export function fnA(): string {\n  return 'A';\n}\n");
    writeFileSync(join(dir, 'moduleB.ts'), "export function fnB(): string {\n  return 'B';\n}\n");
    writeFileSync(join(dir, 'multiStarBarrel.ts'), "export * from './moduleA';\nexport * from './moduleB';\n");
    writeFileSync(
      join(dir, 'multiStarConsumer.ts'),
      [
        "import { fnA, fnB } from './multiStarBarrel';",
        '',
        'export function useMultiStar(): void {',
        '  fnA();',
        '  fnB();',
        '}',
        '',
      ].join('\n'),
    );

    writeFileSync(join(dir, 'typeA.ts'), 'export interface TypeA {\n  a: string;\n}\n');
    writeFileSync(join(dir, 'typeB.ts'), 'export interface TypeB {\n  b: string;\n}\n');
    writeFileSync(join(dir, 'multiStarTypeBarrel.ts'), "export * from './typeA';\nexport * from './typeB';\n");
    writeFileSync(
      join(dir, 'multiStarTypeConsumer.ts'),
      [
        "import { TypeA, TypeB } from './multiStarTypeBarrel';",
        '',
        'export function useMultiStarTypes(a: TypeA, b: TypeB): void {',
        '  void a;',
        '  void b;',
        '}',
        '',
      ].join('\n'),
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function parseAndExtract(filePath: string) {
    const content = readFileSync(filePath, 'utf-8');
    const syntaxTree = parseCode(content, 'typescript', '.ts');
    const extracted = extractEntitiesForFile(syntaxTree.rootNode, filePath);
    const fileEntity = createFileEntityFromContent(filePath, content, new Date());
    return { rootNode: syntaxTree.rootNode, extracted, fileEntity, content };
  }

  it('(a) useMultiStar() gets CALLS edges to BOTH fnA in moduleA.ts and fnB in moduleB.ts', () => {
    const moduleA = parseAndExtract(join(dir, 'moduleA.ts'));
    const moduleB = parseAndExtract(join(dir, 'moduleB.ts'));
    const barrel = parseAndExtract(join(dir, 'multiStarBarrel.ts'));
    const consumer = parseAndExtract(join(dir, 'multiStarConsumer.ts'));

    const barrelIndex = buildReExportIndex([
      { filePath: join(dir, 'multiStarBarrel.ts'), reExports: extractReExports(barrel.rootNode, join(dir, 'multiStarBarrel.ts')) },
    ]);
    const localExportsIndex = buildLocalExportsIndex([
      { filePath: join(dir, 'moduleA.ts'), names: extractLocalExportedNames(moduleA.rootNode, join(dir, 'moduleA.ts')) },
      { filePath: join(dir, 'moduleB.ts'), names: extractLocalExportedNames(moduleB.rootNode, join(dir, 'moduleB.ts')) },
    ]);

    const built = buildParsedFileEntities(
      consumer.fileEntity,
      consumer.extracted,
      consumer.rootNode,
      { deepAnalysis: true, includeExternals: false, barrelIndex, localExportsIndex },
    );
    const moduleABuilt = buildParsedFileEntities(
      moduleA.fileEntity,
      moduleA.extracted,
      moduleA.rootNode,
      { deepAnalysis: true, includeExternals: false, barrelIndex, localExportsIndex },
    );
    const moduleBBuilt = buildParsedFileEntities(
      moduleB.fileEntity,
      moduleB.extracted,
      moduleB.rootNode,
      { deepAnalysis: true, includeExternals: false, barrelIndex, localExportsIndex },
    );
    const files = [built, moduleABuilt, moduleBBuilt];
    resolveProjectSymbolEdges(files, buildProjectSymbolCatalog(files));

    const callerId = built.functions.find((fn) => fn.name === 'useMultiStar')?.id;
    const callees = built.callEdges
      .filter((edge) => edge.callerId === callerId)
      .map((e) => e.calleeId)
      .sort();
    expect(callees).toEqual([
      moduleABuilt.functions.find((fn) => fn.name === 'fnA')?.id,
      moduleBBuilt.functions.find((fn) => fn.name === 'fnB')?.id,
    ].sort());
  });

  it('(b) useMultiStarTypes() TypeRefs: TypeA keys on typeA.ts and TypeB keys on typeB.ts', () => {
    const typeA = parseAndExtract(join(dir, 'typeA.ts'));
    const typeB = parseAndExtract(join(dir, 'typeB.ts'));
    const barrel = parseAndExtract(join(dir, 'multiStarTypeBarrel.ts'));
    const consumer = parseAndExtract(join(dir, 'multiStarTypeConsumer.ts'));

    const barrelIndex = buildReExportIndex([
      { filePath: join(dir, 'multiStarTypeBarrel.ts'), reExports: extractReExports(barrel.rootNode, join(dir, 'multiStarTypeBarrel.ts')) },
    ]);
    const localExportsIndex = buildLocalExportsIndex([
      { filePath: join(dir, 'typeA.ts'), names: extractLocalExportedNames(typeA.rootNode, join(dir, 'typeA.ts')) },
      { filePath: join(dir, 'typeB.ts'), names: extractLocalExportedNames(typeB.rootNode, join(dir, 'typeB.ts')) },
    ]);

    const built = buildParsedFileEntities(
      consumer.fileEntity,
      consumer.extracted,
      consumer.rootNode,
      { deepAnalysis: true, includeExternals: false, barrelIndex, localExportsIndex },
    );

    const typeARef = built.typeRefs.find((t) => t.name === 'TypeA');
    const typeBRef = built.typeRefs.find((t) => t.name === 'TypeB');
    expect(typeARef).toBeDefined();
    expect(typeBRef).toBeDefined();
    expect(typeARef!.definingFile).toBe(join(dir, 'typeA.ts'));
    expect(typeBRef!.definingFile).toBe(join(dir, 'typeB.ts'));
  });
});
