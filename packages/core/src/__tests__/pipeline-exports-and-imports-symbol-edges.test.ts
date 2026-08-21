/**
 * EXPORTS and IMPORTS_SYMBOL edge construction in the pipeline
 * (batch-three edge-truthfulness fix set).
 *
 * Both edge types were declared in @codegraph/types (and, for EXPORTS,
 * backed by a Cypher template) but never actually built anywhere in the
 * indexing pipeline, so neither edge was ever written to the graph. This
 * covers `buildParsedFileEntities`'s new `exportsEdges` and
 * `importsSymbolEdges` fields:
 *
 *   - exportsEdges: built from the `isExported` flag every entity type
 *     already carries (functions, classes, interfaces, variables, types,
 *     components), not from anything TypeScript-specific.
 *   - importsSymbolEdges: built from each import's named specifiers,
 *     pointing at the DECLARED name/file, using the barrel-aware
 *     ResolvedImportMap (wave 3a/3b) when available and the raw specifier
 *     name plus resolvedPath otherwise. Namespace imports and imports with
 *     no resolvedPath (external/unresolved) are excluded.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractReExports, type ReExportEntity } from '@codegraph/plugin-typescript';
import {
  registerPlugins,
  parseCode,
  extractEntitiesForFile,
  createFileEntityFromContent,
  buildParsedFileEntities,
  buildReExportIndex,
} from '../pipeline';

describe('buildParsedFileEntities: exportsEdges (end-to-end)', () => {
  let dir: string;

  beforeAll(() => {
    registerPlugins();
    dir = mkdtempSync(join(tmpdir(), 'exports-edges-test-'));
    writeFileSync(
      join(dir, 'mixed.ts'),
      [
        'export function exportedFn(): void {}',
        'function localFn(): void {}',
        '',
        'export class ExportedClass {}',
        'class LocalClass {}',
        '',
        'export interface ExportedInterface { x: string; }',
        'interface LocalInterface { x: string; }',
        '',
        'export const exportedVar = 1;',
        'const localVar = 2;',
        '',
        'export type ExportedType = string;',
        'type LocalType = string;',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'component.tsx'),
      [
        "import React from 'react';",
        '',
        'export function ExportedWidget() {',
        '  return <div>hi</div>;',
        '}',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'joined.ts'),
      [
        'export interface Joined { label: string; }',
        'export class Joined {',
        '  value = 1;',
        '  methodValue(): number { return this.value; }',
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
    const ext = filePath.endsWith('.tsx') ? '.tsx' : '.ts';
    const syntaxTree = parseCode(content, 'typescript', ext);
    const extracted = extractEntitiesForFile(syntaxTree.rootNode, filePath);
    const fileEntity = createFileEntityFromContent(filePath, content, new Date());
    return { rootNode: syntaxTree.rootNode, extracted, fileEntity };
  }

  it('collects an EXPORTS edge for every exported symbol and none for unexported ones', () => {
    const filePath = join(dir, 'mixed.ts');
    const { rootNode, extracted, fileEntity } = parseAndExtract(filePath);

    const built = buildParsedFileEntities(fileEntity, extracted, rootNode, { deepAnalysis: true });

    const byName = new Map(built.exportsEdges.map((e) => [e.symbolName, e]));

    expect(byName.get('exportedFn')).toEqual({ filePath, symbolName: 'exportedFn', symbolKind: 'Function' });
    expect(byName.get('ExportedClass')).toEqual({ filePath, symbolName: 'ExportedClass', symbolKind: 'Class' });
    expect(byName.get('ExportedInterface')).toEqual({ filePath, symbolName: 'ExportedInterface', symbolKind: 'Interface' });
    expect(byName.get('exportedVar')).toEqual({ filePath, symbolName: 'exportedVar', symbolKind: 'Variable' });
    expect(byName.get('ExportedType')).toEqual({ filePath, symbolName: 'ExportedType', symbolKind: 'Type' });

    // Unexported siblings must not produce an EXPORTS edge.
    expect(byName.has('localFn')).toBe(false);
    expect(byName.has('LocalClass')).toBe(false);
    expect(byName.has('LocalInterface')).toBe(false);
    expect(byName.has('localVar')).toBe(false);
    expect(byName.has('LocalType')).toBe(false);
  });

  it('collects an EXPORTS edge for an exported React component', () => {
    const filePath = join(dir, 'component.tsx');
    const { rootNode, extracted, fileEntity } = parseAndExtract(filePath);

    const built = buildParsedFileEntities(fileEntity, extracted, rootNode, { deepAnalysis: true });

    const componentEdge = built.exportsEdges.find(
      (e) => e.symbolName === 'ExportedWidget' && e.symbolKind === 'Component',
    );
    expect(componentEdge).toBeDefined();
  });

  it('exports both Joined declarations but not the exported class members', () => {
    const filePath = join(dir, 'joined.ts');
    const { rootNode, extracted, fileEntity } = parseAndExtract(filePath);

    const built = buildParsedFileEntities(fileEntity, extracted, rootNode, { deepAnalysis: true });

    expect(
      built.exportsEdges.map(({ symbolName, symbolKind }) => `${symbolName}:${symbolKind}`).sort(),
    ).toEqual(['Joined:Class', 'Joined:Interface']);
  });
});

describe('buildParsedFileEntities: importsSymbolEdges (end-to-end)', () => {
  let dir: string;

  beforeAll(() => {
    registerPlugins();
    dir = mkdtempSync(join(tmpdir(), 'imports-symbol-edges-test-'));
    writeFileSync(
      join(dir, 'target.ts'),
      'export function targetFn(): void {}\nexport function otherFn(): void {}\n',
    );
    writeFileSync(
      join(dir, 'consumer.ts'),
      [
        "import { targetFn, otherFn as renamedFn } from './target';",
        "import * as NS from './target';",
        "import { lodashLike } from 'some-external-package';",
        '',
        'export function useThem(): void {',
        '  targetFn();',
        '  renamedFn();',
        '  NS.targetFn();',
        '}',
        '',
      ].join('\n'),
    );

    // --- barrel fixture ---
    writeFileSync(join(dir, 'origin.ts'), 'export function originFn(): void {}\n');
    writeFileSync(join(dir, 'barrel.ts'), "export { originFn } from './origin';\n");
    writeFileSync(
      join(dir, 'barrelConsumer.ts'),
      [
        "import { originFn } from './barrel';",
        '',
        'export function useOrigin(): void {',
        '  originFn();',
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
    return { rootNode: syntaxTree.rootNode, extracted, fileEntity };
  }

  it('builds an IMPORTS_SYMBOL edge for a plain named specifier, pointing at the declared name and resolved file', () => {
    const consumer = parseAndExtract(join(dir, 'consumer.ts'));
    const built = buildParsedFileEntities(consumer.fileEntity, consumer.extracted, consumer.rootNode, { deepAnalysis: true });

    const edge = built.importsSymbolEdges.find((e) => e.symbolName === 'targetFn' && !e.alias);
    expect(edge).toBeDefined();
    expect(edge).toEqual({
      fromFilePath: join(dir, 'consumer.ts'),
      toFilePath: join(dir, 'target.ts'),
      symbolName: 'targetFn',
      isDefault: false,
    });
  });

  it('builds an IMPORTS_SYMBOL edge for a renamed specifier, using the origin-declared name and carrying the local alias', () => {
    const consumer = parseAndExtract(join(dir, 'consumer.ts'));
    const built = buildParsedFileEntities(consumer.fileEntity, consumer.extracted, consumer.rootNode, { deepAnalysis: true });

    // `otherFn as renamedFn`: the declared name at target.ts is `otherFn`,
    // the local alias `renamedFn` is carried separately, not used as the
    // search key (or the graph write would look for a symbol literally
    // named renamedFn at target.ts, which doesn't exist there).
    const edge = built.importsSymbolEdges.find((e) => e.alias === 'renamedFn');
    expect(edge).toBeDefined();
    expect(edge).toEqual({
      fromFilePath: join(dir, 'consumer.ts'),
      toFilePath: join(dir, 'target.ts'),
      symbolName: 'otherFn',
      alias: 'renamedFn',
      isDefault: false,
    });
  });

  it('excludes namespace imports (import * as NS)', () => {
    const consumer = parseAndExtract(join(dir, 'consumer.ts'));
    const built = buildParsedFileEntities(consumer.fileEntity, consumer.extracted, consumer.rootNode, { deepAnalysis: true });

    // The namespace import binds a whole module, not one exported name: it
    // must contribute zero importsSymbolEdges entries. Only the two named
    // specifiers from the first import statement should be present.
    expect(built.importsSymbolEdges).toHaveLength(2);
  });

  it('excludes an import with no resolvedPath (external/unresolved package)', () => {
    const consumer = parseAndExtract(join(dir, 'consumer.ts'));
    const built = buildParsedFileEntities(consumer.fileEntity, consumer.extracted, consumer.rootNode, { deepAnalysis: true });

    expect(built.importsSymbolEdges.some((e) => e.symbolName === 'lodashLike')).toBe(false);
  });

  it('with a barrelIndex, resolves the IMPORTS_SYMBOL edge through the barrel to the origin file and declared name', () => {
    const origin = parseAndExtract(join(dir, 'origin.ts'));
    const barrel = parseAndExtract(join(dir, 'barrel.ts'));
    const barrelConsumer = parseAndExtract(join(dir, 'barrelConsumer.ts'));

    const barrelIndex = buildReExportIndex([
      { filePath: join(dir, 'barrel.ts'), reExports: extractReExports(barrel.rootNode, join(dir, 'barrel.ts')) },
    ] satisfies Array<{ filePath: string; reExports: ReExportEntity[] }>);

    const built = buildParsedFileEntities(
      barrelConsumer.fileEntity,
      barrelConsumer.extracted,
      barrelConsumer.rootNode,
      { deepAnalysis: true, barrelIndex },
    );

    const edge = built.importsSymbolEdges.find((e) => e.symbolName === 'originFn');
    expect(edge).toBeDefined();
    // Must point at origin.ts, not barrel.ts: the symbol node actually lives there.
    expect(edge!.toFilePath).toBe(join(dir, 'origin.ts'));
  });

  it('without a barrelIndex, the IMPORTS_SYMBOL edge points at the barrel itself (documents the degraded, still-safe case)', () => {
    const barrelConsumer = parseAndExtract(join(dir, 'barrelConsumer.ts'));

    const built = buildParsedFileEntities(
      barrelConsumer.fileEntity,
      barrelConsumer.extracted,
      barrelConsumer.rootNode,
      { deepAnalysis: true },
    );

    const edge = built.importsSymbolEdges.find((e) => e.symbolName === 'originFn');
    expect(edge).toBeDefined();
    expect(edge!.toFilePath).toBe(join(dir, 'barrel.ts'));
  });
});
