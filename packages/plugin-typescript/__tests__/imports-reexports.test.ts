/**
 * Barrel re-export extraction (Bug 2 in the batch-three fix set, part a).
 *
 * `imports.ts` previously only walked `import_statement` nodes, so
 * `export * from './x'` and `export { y } from './y'` (both `export_statement`
 * nodes) were invisible to the extractor entirely. This covers the new
 * `extractReExports` walk in isolation, ahead of the cross-file chain
 * resolution that consumes it in @codegraph/core's pipeline.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Parser from 'tree-sitter';
import { grammars } from '../src';
import { extractReExports } from '../src/extractors/imports';

let parser: Parser;
let dir: string;

function parseCode(code: string): Parser.SyntaxNode {
  return parser.parse(code).rootNode;
}

describe('extractReExports', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(grammars.typescript as Parameters<Parser['setLanguage']>[0]);
    // Re-export source resolution reuses resolveImportPath, which checks the
    // filesystem, so give it real sibling files to resolve against.
    dir = mkdtempSync(join(tmpdir(), 'reexports-test-'));
    writeFileSync(join(dir, 'origin.ts'), 'export function foo() {}\n');
    writeFileSync(join(dir, 'mid.ts'), "export { foo } from './origin';\n");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('extracts a bare star re-export', () => {
    const code = `export * from './origin';`;
    const rootNode = parseCode(code);
    const filePath = join(dir, 'barrel.ts');
    const reExports = extractReExports(rootNode, filePath);

    expect(reExports).toHaveLength(1);
    expect(reExports[0]).toMatchObject({
      exportedName: '*',
      source: './origin',
      sourceResolvedPath: join(dir, 'origin.ts'),
    });
    expect(reExports[0]!.localName).toBeUndefined();
  });

  it('extracts a namespace re-export (export * as ns from)', () => {
    const code = `export * as ns from './origin';`;
    const rootNode = parseCode(code);
    const filePath = join(dir, 'barrel.ts');
    const reExports = extractReExports(rootNode, filePath);

    expect(reExports).toHaveLength(1);
    expect(reExports[0]).toMatchObject({
      exportedName: '*',
      localName: 'ns',
      source: './origin',
      sourceResolvedPath: join(dir, 'origin.ts'),
    });
  });

  it('extracts a named re-export', () => {
    const code = `export { foo } from './origin';`;
    const rootNode = parseCode(code);
    const filePath = join(dir, 'barrel.ts');
    const reExports = extractReExports(rootNode, filePath);

    expect(reExports).toHaveLength(1);
    expect(reExports[0]).toMatchObject({
      exportedName: 'foo',
      source: './origin',
      sourceResolvedPath: join(dir, 'origin.ts'),
    });
    expect(reExports[0]!.localName).toBeUndefined();
  });

  it('extracts an aliased named re-export', () => {
    const code = `export { foo as bar } from './origin';`;
    const rootNode = parseCode(code);
    const filePath = join(dir, 'barrel.ts');
    const reExports = extractReExports(rootNode, filePath);

    expect(reExports).toHaveLength(1);
    expect(reExports[0]).toMatchObject({
      exportedName: 'foo',
      localName: 'bar',
      source: './origin',
    });
  });

  it('extracts multiple named specifiers from one export clause', () => {
    const code = `export { foo, bar as baz } from './origin';`;
    const rootNode = parseCode(code);
    const filePath = join(dir, 'barrel.ts');
    const reExports = extractReExports(rootNode, filePath);

    expect(reExports).toHaveLength(2);
    expect(reExports.find((r) => r.exportedName === 'foo')).toBeDefined();
    expect(reExports.find((r) => r.exportedName === 'bar' && r.localName === 'baz')).toBeDefined();
  });

  it('skips a plain local export (no source)', () => {
    const code = `
const local = 1;
export { local };
`;
    const rootNode = parseCode(code);
    const filePath = join(dir, 'barrel.ts');
    const reExports = extractReExports(rootNode, filePath);

    expect(reExports).toHaveLength(0);
  });

  it('skips a declaration export (no source)', () => {
    const code = `export function foo() {}`;
    const rootNode = parseCode(code);
    const filePath = join(dir, 'barrel.ts');
    const reExports = extractReExports(rootNode, filePath);

    expect(reExports).toHaveLength(0);
  });

  it('leaves sourceResolvedPath unset for an unresolvable source', () => {
    const code = `export { foo } from 'some-external-package';`;
    const rootNode = parseCode(code);
    const filePath = join(dir, 'barrel.ts');
    const reExports = extractReExports(rootNode, filePath);

    expect(reExports).toHaveLength(1);
    expect(reExports[0]!.sourceResolvedPath).toBeUndefined();
  });
});
