/**
 * Type Reference Extractor: cross-file identity tests.
 *
 * Covers the definingFile resolution fix: a non-primitive TypeRef must key on
 * the file that actually DECLARES the type, not the file that merely
 * references it, per the docstring in packages/plugin-common/src/types.ts and
 * packages/plugin-typescript/src/extractors/type-refs.ts.
 *
 * Three cases:
 *   (a) Two files importing the same type from a third file produce the SAME
 *       TypeRef id, keyed on the declaring file.
 *   (b) A locally-declared type keys on the local file.
 *   (c) An unresolvable name keys on the referencing file (regression guard:
 *       callers that pass no resolution context, or a name that matches
 *       neither local nor imported, get today's pre-fix behavior).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Parser from 'tree-sitter';
import { grammars } from '../src';
import { extractTypeRefsForFunction, type TypeResolutionContext } from '../src/extractors/type-refs';
import { extractAllEntities } from '../src/extractors';

let parser: Parser;

function parseCode(code: string): Parser.SyntaxNode {
  const tree = parser.parse(code);
  return tree.rootNode;
}

/** Find the first function-like node in the tree (declaration or arrow assigned to a const). */
function findFirstFunctionNode(root: Parser.SyntaxNode): Parser.SyntaxNode {
  const found = findNode(root);
  if (!found) throw new Error('No function node found in parsed source');
  return found;
}

function findNode(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  if (
    node.type === 'function_declaration' ||
    node.type === 'arrow_function' ||
    node.type === 'function_expression'
  ) {
    return node;
  }
  for (const child of node.children) {
    const found = findNode(child);
    if (found) return found;
  }
  return null;
}

describe('extractTypeRefsForFunction: cross-file definingFile resolution', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(grammars.typescript as Parameters<Parser['setLanguage']>[0]);
  });

  it('(a) two files importing the same type from a third file produce the SAME TypeRef id, keyed on the declaring file', () => {
    const declaringFile = '/project/src/models/user.ts';

    const codeA = `
function acceptUser(u: User): void {}
`;
    const rootA = parseCode(codeA);
    const fnA = findFirstFunctionNode(rootA);
    const resolutionA: TypeResolutionContext = {
      localTypeNames: new Set(),
      importedTypes: new Map([['User', { filePath: declaringFile, exportedName: 'User' }]]),
    };
    const resultA = extractTypeRefsForFunction(fnA, 'fn::a::acceptUser', '/project/src/moduleA.ts', resolutionA);

    const codeB = `
function printUser(u: User): void {}
`;
    const rootB = parseCode(codeB);
    const fnB = findFirstFunctionNode(rootB);
    const resolutionB: TypeResolutionContext = {
      localTypeNames: new Set(),
      importedTypes: new Map([['User', { filePath: declaringFile, exportedName: 'User' }]]),
    };
    const resultB = extractTypeRefsForFunction(fnB, 'fn::b::printUser', '/project/src/moduleB.ts', resolutionB);

    const userRefA = resultA.typeRefs.find((t) => t.name === 'User');
    const userRefB = resultB.typeRefs.find((t) => t.name === 'User');

    expect(userRefA).toBeDefined();
    expect(userRefB).toBeDefined();

    // Both moduleA.ts and moduleB.ts reference the same imported User type;
    // the TypeRef id must be identical and keyed on the declaring file, not
    // either referencing file.
    expect(userRefA!.id).toBe(userRefB!.id);
    expect(userRefA!.id).toBe(`type::typescript::${declaringFile}::User`);
    expect(userRefA!.definingFile).toBe(declaringFile);
    expect(userRefB!.definingFile).toBe(declaringFile);
  });

  it('(b) a locally-declared type keys on the local file', () => {
    const localFile = '/project/src/user.ts';
    const code = `
function acceptUser(u: User): void {}
`;
    const root = parseCode(code);
    const fn = findFirstFunctionNode(root);
    const resolution: TypeResolutionContext = {
      // User is declared locally in this same file (e.g. via a class/interface/
      // type alias/enum extracted alongside this function).
      localTypeNames: new Set(['User']),
      importedTypePaths: new Map(),
    };
    const result = extractTypeRefsForFunction(fn, 'fn::acceptUser', localFile, resolution);

    const userRef = result.typeRefs.find((t) => t.name === 'User');
    expect(userRef).toBeDefined();
    expect(userRef!.id).toBe(`type::typescript::${localFile}::User`);
    expect(userRef!.definingFile).toBe(localFile);
  });

  it('(c) an unresolvable name keys on the referencing file (regression guard)', () => {
    const referencingFile = '/project/src/ambient.ts';
    const code = `
function acceptWidget(w: Widget): void {}
`;
    const root = parseCode(code);
    const fn = findFirstFunctionNode(root);

    // Widget is neither locally declared nor imported (e.g. an ambient/global
    // type). This must fall back to today's pre-fix behavior: keyed on the
    // referencing file.
    const resolution: TypeResolutionContext = {
      localTypeNames: new Set(),
      importedTypePaths: new Map(),
    };
    const result = extractTypeRefsForFunction(fn, 'fn::acceptWidget', referencingFile, resolution);

    const widgetRef = result.typeRefs.find((t) => t.name === 'Widget');
    expect(widgetRef).toBeDefined();
    expect(widgetRef!.id).toBe(`type::typescript::${referencingFile}::Widget`);
    expect(widgetRef!.definingFile).toBe(referencingFile);
  });

  it('(c continued) omitting the resolution context entirely is a pure pass-through (backward compatibility)', () => {
    const referencingFile = '/project/src/legacy.ts';
    const code = `
function acceptWidget(w: Widget): void {}
`;
    const root = parseCode(code);
    const fn = findFirstFunctionNode(root);

    // No 4th argument at all: existing callers (plugin-python/go/rust use a
    // different code path entirely, but any TS caller that predates this fix)
    // must see identical output to before.
    const result = extractTypeRefsForFunction(fn, 'fn::acceptWidget', referencingFile);

    const widgetRef = result.typeRefs.find((t) => t.name === 'Widget');
    expect(widgetRef).toBeDefined();
    expect(widgetRef!.id).toBe(`type::typescript::${referencingFile}::Widget`);
  });
});

describe('extractAllEntities: end-to-end cross-file wiring (real files on disk)', () => {
  // The imports extractor resolves relative import paths via existsSync, so this
  // wiring test needs real files rather than mock ImportEntity objects: it proves
  // extractAllEntities (packages/plugin-typescript/src/extractors/index.ts) builds
  // the local-declaration set and import-resolution map correctly and threads them
  // into extractTypeRefsForFunction.
  let dir: string;

  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(grammars.typescript as Parameters<Parser['setLanguage']>[0]);

    dir = mkdtempSync(join(tmpdir(), 'cg-type-refs-e2e-'));
    writeFileSync(join(dir, 'user.ts'), 'export interface User { id: string; }\n');
    writeFileSync(
      join(dir, 'moduleA.ts'),
      "import { User } from './user';\nexport function acceptUser(u: User): void {}\n",
    );
    writeFileSync(
      join(dir, 'moduleB.ts'),
      "import { User } from './user';\nexport function printUser(u: User): void {}\n",
    );
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('two files importing the same type from a third file collapse onto one TypeRef node', () => {
    const pathA = join(dir, 'moduleA.ts');
    const pathB = join(dir, 'moduleB.ts');
    const declaringPath = join(dir, 'user.ts');

    const resultA = extractAllEntities(parseCode(readFileSync(pathA, 'utf8')), pathA);
    const resultB = extractAllEntities(parseCode(readFileSync(pathB, 'utf8')), pathB);

    const userRefA = resultA.typeRefs.find((t) => t.name === 'User');
    const userRefB = resultB.typeRefs.find((t) => t.name === 'User');

    expect(userRefA).toBeDefined();
    expect(userRefB).toBeDefined();
    expect(userRefA!.id).toBe(userRefB!.id);
    expect(userRefA!.id).toBe(`type::typescript::${declaringPath}::User`);
  });

  it('a locally-declared type keys on the local file when extracted through extractAllEntities', () => {
    const localPath = join(dir, 'local.ts');
    const code = 'export interface User { id: string; }\nexport function acceptUser(u: User): void {}\n';
    const result = extractAllEntities(parseCode(code), localPath);

    const userRef = result.typeRefs.find((t) => t.name === 'User');
    expect(userRef).toBeDefined();
    expect(userRef!.id).toBe(`type::typescript::${localPath}::User`);
  });
});

/**
 * Adversarial review findings (batch 3): two identity collapses the first pass
 * missed.
 *
 *   Blocker 1: a type imported through a barrel (`export { User } from './origin'`,
 *   then `import { User } from './barrel'`) kept its TypeRef keyed on the barrel
 *   file, because extractAllEntities only ever saw each file's own resolvedPath,
 *   never the barrel chain. Fix: an optional `resolvedImports` map, built by the
 *   indexing pipeline (barrel-chain-aware), takes priority when present.
 *
 *   Blocker 2: `import { User as U }` produced a TypeRef named "U" keyed on the
 *   origin file: right file, wrong name, so it was still a third, disconnected
 *   node next to the (origin file, "User") node used by non-aliased importers.
 *   Identity must be (definingFile, DECLARED name). Fix: same-file import
 *   resolution (`importedTypes`, built from ImportEntity specifiers, no barrel
 *   map required) now also rewrites the name back to the specifier's original,
 *   pre-alias name.
 */
describe('cross-file identity: barrel imports + import aliases', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(grammars.typescript as Parameters<Parser['setLanguage']>[0]);
  });

  it('(a) aliased direct import produces TypeRef (types.ts, User), not (types.ts, U)', () => {
    const typesPath = '/project/src/types.ts';
    const referencingPath = '/project/src/renamed.ts';

    // import { User as U } from './types'; function f(u: U): U { ... }
    // The AST only ever sees the local alias "U" as the annotation text.
    const code = `
function renamedFn(u: U): U { return u; }
`;
    const root = parseCode(code);
    const fn = findFirstFunctionNode(root);

    // Layer A only: same-file import resolution built from ImportEntity
    // specifiers, no resolvedImports (barrel) map involved.
    const resolution: TypeResolutionContext = {
      localTypeNames: new Set(),
      importedTypes: new Map([['U', { filePath: typesPath, exportedName: 'User' }]]),
    };
    const result = extractTypeRefsForFunction(fn, 'fn::renamedFn', referencingPath, resolution);

    const ref = result.typeRefs.find((t) => t.name === 'User' || t.name === 'U');
    expect(ref).toBeDefined();
    // Must be (types.ts, User): both the file AND the name are corrected.
    expect(ref!.name).toBe('User');
    expect(ref!.definingFile).toBe(typesPath);
    expect(ref!.id).toBe(`type::typescript::${typesPath}::User`);
    // Must NOT produce a third node keyed on the right file but the wrong name.
    expect(ref!.id).not.toBe(`type::typescript::${typesPath}::U`);
  });

  it('(b) with a hand-built resolvedImports map, a barrel import produces (origin.ts, User)', () => {
    const originPath = '/project/src/origin.ts';
    const barrelPath = '/project/src/barrel.ts';
    const referencingPath = '/project/src/viaBarrel.ts';

    // import { User } from './barrel'; function f(u: User): User { ... }
    const code = `
function fromBarrel(u: User): User { return u; }
`;
    const root = parseCode(code);
    const fn = findFirstFunctionNode(root);

    const resolution: TypeResolutionContext = {
      localTypeNames: new Set(),
      // Same-file resolution alone (no barrel-chain knowledge) would point at
      // the barrel file, not the origin: this is what proves resolvedImports
      // must take priority, not just be consulted when importedTypes is empty.
      importedTypes: new Map([['User', { filePath: barrelPath, exportedName: 'User' }]]),
      // Hand-built stand-in for the pipeline's real barrel-chain resolution.
      resolvedImports: new Map([['User', { filePath: originPath, exportedName: 'User' }]]),
    };
    const result = extractTypeRefsForFunction(fn, 'fn::fromBarrel', referencingPath, resolution);

    const ref = result.typeRefs.find((t) => t.name === 'User');
    expect(ref).toBeDefined();
    expect(ref!.definingFile).toBe(originPath);
    expect(ref!.id).toBe(`type::typescript::${originPath}::User`);
    expect(ref!.id).not.toBe(`type::typescript::${barrelPath}::User`);
  });

  it('(c) resolvedImports absent keeps current behavior (compat guard: no crash, same-file resolution still applies)', () => {
    const barrelPath = '/project/src/barrel.ts';
    const referencingPath = '/project/src/viaBarrel.ts';

    const code = `
function fromBarrel(u: User): User { return u; }
`;
    const root = parseCode(code);
    const fn = findFirstFunctionNode(root);

    // No resolvedImports at all (producer not landed / single-file indexing):
    // only same-file resolution is available, so this keys on the barrel file,
    // not the origin. That's the known, documented gap this fix does NOT close
    // on its own (tracked as the barrel chain, owned by another agent); the
    // guarantee here is just that behavior is well-defined and doesn't regress.
    const resolution: TypeResolutionContext = {
      localTypeNames: new Set(),
      importedTypes: new Map([['User', { filePath: barrelPath, exportedName: 'User' }]]),
    };
    const result = extractTypeRefsForFunction(fn, 'fn::fromBarrel', referencingPath, resolution);

    const ref = result.typeRefs.find((t) => t.name === 'User');
    expect(ref).toBeDefined();
    expect(ref!.definingFile).toBe(barrelPath);
    expect(ref!.id).toBe(`type::typescript::${barrelPath}::User`);
  });

  it('(c continued) omitting resolvedImports entirely from extractAllEntities is a pure pass-through', () => {
    const localPath = '/project/src/plain.ts';
    const code = `
interface User { id: string; }
function acceptUser(u: User): void {}
`;
    const root = parseCode(code);
    // No 3rd argument at all.
    const result = extractAllEntities(root, localPath);

    const ref = result.typeRefs.find((t) => t.name === 'User');
    expect(ref).toBeDefined();
    expect(ref!.definingFile).toBe(localPath);
    expect(ref!.id).toBe(`type::typescript::${localPath}::User`);
  });
});

describe('extractAllEntities: end-to-end barrel + alias wiring (real files, mirrors fixture-a)', () => {
  let dir: string;

  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(grammars.typescript as Parameters<Parser['setLanguage']>[0]);

    dir = mkdtempSync(join(tmpdir(), 'cg-type-refs-barrel-e2e-'));
    writeFileSync(join(dir, 'types.ts'), 'export interface User { id: string; name: string; }\n');
    writeFileSync(join(dir, 'a.ts'), "import { User } from './types';\nexport function makeUser(input: User): User { return input; }\n");
    writeFileSync(join(dir, 'barrel.ts'), "export { User } from './types';\n");
    writeFileSync(join(dir, 'viaBarrel.ts'), "import { User } from './barrel';\nexport function fromBarrel(u: User): User { return u; }\n");
    writeFileSync(join(dir, 'renamed.ts'), "import { User as U } from './types';\nexport function renamedFn(u: U): U { return u; }\n");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('barrel import converges on the origin-keyed node when resolvedImports is supplied', () => {
    const typesPath = join(dir, 'types.ts');
    const aPath = join(dir, 'a.ts');
    const viaBarrelPath = join(dir, 'viaBarrel.ts');

    const resultA = extractAllEntities(parseCode(readFileSync(aPath, 'utf8')), aPath);

    // Hand-built stand-in for the pipeline's real barrel-chain resolution
    // (ResolvedImportMap), since the producer (imports.ts / pipeline.ts) has
    // not landed yet. viaBarrel.ts's own ImportEntity.resolvedPath points at
    // barrel.ts; resolvedImports corrects it to the true origin, types.ts.
    const resolvedImports = new Map([['User', { filePath: typesPath, exportedName: 'User' }]]);
    const resultViaBarrel = extractAllEntities(
      parseCode(readFileSync(viaBarrelPath, 'utf8')),
      viaBarrelPath,
      resolvedImports,
    );

    const refA = resultA.typeRefs.find((t) => t.name === 'User');
    const refViaBarrel = resultViaBarrel.typeRefs.find((t) => t.name === 'User');

    expect(refA).toBeDefined();
    expect(refViaBarrel).toBeDefined();
    expect(refViaBarrel!.id).toBe(refA!.id);
    expect(refViaBarrel!.id).toBe(`type::typescript::${typesPath}::User`);
  });

  it('renamed (aliased) import converges on the origin-keyed node under the DECLARED name, with no resolvedImports needed', () => {
    const typesPath = join(dir, 'types.ts');
    const aPath = join(dir, 'a.ts');
    const renamedPath = join(dir, 'renamed.ts');

    const resultA = extractAllEntities(parseCode(readFileSync(aPath, 'utf8')), aPath);
    const resultRenamed = extractAllEntities(parseCode(readFileSync(renamedPath, 'utf8')), renamedPath);

    const refA = resultA.typeRefs.find((t) => t.name === 'User');
    const refRenamed = resultRenamed.typeRefs.find((t) => t.name === 'User');

    expect(refA).toBeDefined();
    expect(refRenamed).toBeDefined();
    expect(refRenamed!.name).toBe('User');
    expect(refRenamed!.id).toBe(refA!.id);
    expect(refRenamed!.id).toBe(`type::typescript::${typesPath}::User`);
  });
});
