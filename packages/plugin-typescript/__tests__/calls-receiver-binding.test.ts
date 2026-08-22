/**
 * Receiver-typed call resolution (Bug 1 in the batch-three fix set).
 *
 * `const s = new Service(); s.method()` used to be dropped entirely: the
 * calls extractor only resolved member-expression callees through
 * localFunctions / importedSymbols / importedNamespaces, none of which know
 * about a variable's runtime class. This file covers the per-file binding
 * table added to close that gap, plus its deliberate conservatism: a name
 * bound to two different classes anywhere in the file is dropped rather than
 * guessed.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import Parser from 'tree-sitter';
import { grammars } from '../src';
import { extractCalls } from '../src/extractors/calls';
import { extractFunctions } from '../src/extractors/functions';
import { extractClasses } from '../src/extractors/classes';
import { extractImports } from '../src/extractors/imports';
import { extractAllEntities } from '../src/extractors';
import type { ResolvedImportTarget } from '../src/extractors/imports';
import type { ImportEntity } from '@codegraph/types';

let parser: Parser;

function parseCode(code: string): Parser.SyntaxNode {
  return parser.parse(code).rootNode;
}

describe('extractCalls: receiver-typed call binding', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(grammars.typescript as Parameters<Parser['setLanguage']>[0]);
  });

  it('receiver call to an imported class method produces a CALLS edge with the correct callee file', () => {
    const code = `
import { Service } from './service';

function run() {
  const s = new Service();
  s.method();
}
`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'main.ts');
    const mockImport: ImportEntity = {
      id: 'imp-1',
      source: './service',
      filePath: 'main.ts',
      isDefault: false,
      isNamespace: false,
      specifiers: [{ name: 'Service' }],
      resolvedPath: '/project/service.ts',
    };
    const calls = extractCalls(rootNode, 'main.ts', functions, [mockImport], false, []);

    const ref = calls.find((c) => c.calleeName === 'method');
    expect(ref).toBeDefined();
    expect(ref!.calleeFilePath).toBe('/project/service.ts');
    expect(ref!.callerName).toBe('run');
  });

  it('receiver call to a locally declared class method produces a CALLS edge in the same file', () => {
    const code = `
class Service {
  method() {}
}

function run() {
  const s = new Service();
  s.method();
}
`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'main.ts');
    const classes = extractClasses(rootNode, 'main.ts');
    const calls = extractCalls(rootNode, 'main.ts', functions, [], false, classes);

    const ref = calls.find((c) => c.calleeName === 'method' && c.callerName === 'run');
    expect(ref).toBeDefined();
    expect(ref!.calleeFilePath).toBe('main.ts');
  });

  it('receiver bound twice to different classes produces no guessed edge', () => {
    const code = `
import { ServiceA } from './service-a';
import { ServiceB } from './service-b';

function runA() {
  const s = new ServiceA();
  s.method();
}

function runB() {
  const s = new ServiceB();
  s.method();
}
`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'main.ts');
    const imports: ImportEntity[] = [
      {
        id: 'imp-a',
        source: './service-a',
        filePath: 'main.ts',
        isDefault: false,
        isNamespace: false,
        specifiers: [{ name: 'ServiceA' }],
        resolvedPath: '/project/service-a.ts',
      },
      {
        id: 'imp-b',
        source: './service-b',
        filePath: 'main.ts',
        isDefault: false,
        isNamespace: false,
        specifiers: [{ name: 'ServiceB' }],
        resolvedPath: '/project/service-b.ts',
      },
    ];
    // includeExternals=true so a dropped-binding call still shows up in the
    // result set (with calleeFilePath undefined) instead of being filtered
    // out entirely, letting the assertion distinguish "no resolution" from
    // "not attributed at all".
    const calls = extractCalls(rootNode, 'main.ts', functions, imports, true, []);

    const methodCalls = calls.filter((c) => c.calleeName === 'method');
    expect(methodCalls).toHaveLength(2);
    for (const call of methodCalls) {
      expect(call.calleeFilePath).toBeUndefined();
    }
  });

  it('receiver reassigned to the same class twice is not treated as a conflict', () => {
    const code = `
import { Service } from './service';

function run() {
  let s = new Service();
  s = new Service();
  s.method();
}
`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'main.ts');
    const mockImport: ImportEntity = {
      id: 'imp-1',
      source: './service',
      filePath: 'main.ts',
      isDefault: false,
      isNamespace: false,
      specifiers: [{ name: 'Service' }],
      resolvedPath: '/project/service.ts',
    };
    const calls = extractCalls(rootNode, 'main.ts', functions, [mockImport], false, []);

    const ref = calls.find((c) => c.calleeName === 'method');
    expect(ref).toBeDefined();
    expect(ref!.calleeFilePath).toBe('/project/service.ts');
  });

  it('typed parameter binding resolves a receiver call without a `new` expression', () => {
    const code = `
import { Service } from './service';

function run(svc: Service) {
  svc.method();
}
`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'main.ts');
    const mockImport: ImportEntity = {
      id: 'imp-1',
      source: './service',
      filePath: 'main.ts',
      isDefault: false,
      isNamespace: false,
      specifiers: [{ name: 'Service' }],
      resolvedPath: '/project/service.ts',
    };
    const calls = extractCalls(rootNode, 'main.ts', functions, [mockImport], false, []);

    const ref = calls.find((c) => c.calleeName === 'method');
    expect(ref).toBeDefined();
    expect(ref!.calleeFilePath).toBe('/project/service.ts');
  });

  it('receiver call to an imported class carries calleeClassName so the graph layer can disambiguate same-named methods (reviewer blocker 3)', () => {
    // Reproduces the fixture-b scenario: Service and OtherService both declare
    // a `work()` method in the same file. Without calleeClassName, the graph
    // layer's {name, filePath} match on the callee can't tell which class a
    // given receiver call is actually typed as, and lands on both.
    const code = `
import { Service, OtherService } from './service';

function runBasic() {
  const s = new Service();
  s.work();
}
`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'app.ts');
    const mockImport: ImportEntity = {
      id: 'imp-1',
      source: './service',
      filePath: 'app.ts',
      isDefault: false,
      isNamespace: false,
      specifiers: [{ name: 'Service' }, { name: 'OtherService' }],
      resolvedPath: '/project/service.ts',
    };
    const calls = extractCalls(rootNode, 'app.ts', functions, [mockImport], false, []);

    const ref = calls.find((c) => c.calleeName === 'work');
    expect(ref).toBeDefined();
    expect(ref!.calleeFilePath).toBe('/project/service.ts');
    expect(ref!.calleeClassName).toBe('Service');
  });

  it('keeps class overload identities distinct and binds a cross-file receiver call only to the implementation', () => {
    const declarationRoot = parseCode(`export class Over {
  work(value: string): string;
  work(value: number): number;
  work(value: string | number): string | number { return value; }
}`);
    const declarationFile = '/project/over.ts';
    const extracted = extractAllEntities(declarationRoot, declarationFile);
    const overClass = extracted.classes.find((entity) => entity.name === 'Over');
    const workFunctions = extracted.functions.filter((entity) => entity.name === 'work');

    expect(overClass).toBeDefined();
    expect(workFunctions).toHaveLength(3);
    expect(new Set(workFunctions.map((entity) => entity.id)).size).toBe(3);
    expect(workFunctions.every((entity) => entity.scopeKey === 'Class:Over')).toBe(true);
    expect(workFunctions.map((entity) => entity.disambiguator)).toEqual([
      expect.stringMatching(/^sig:[a-f0-9]{16}$/),
      expect.stringMatching(/^sig:[a-f0-9]{16}$/),
      expect.stringMatching(/^sig:[a-f0-9]{16}$/),
    ]);
    expect(new Set(workFunctions.map((entity) => entity.disambiguator)).size).toBe(3);
    expect(workFunctions.map((entity) => Reflect.get(entity, 'isOverloadSignature'))).toEqual([
      true,
      true,
      false,
    ]);

    const implementation = workFunctions.find((entity) => entity.startLine === 4);
    expect(implementation).toBeDefined();
    const methodEdges = extracted.hasMethodEdges.filter(
      (edge) => edge.fromId === overClass!.id,
    );
    expect(methodEdges).toEqual([
      expect.objectContaining({ toId: implementation!.id }),
    ]);

    const callerRoot = parseCode(`import { Over } from './over';

export function run(over: Over): string {
  return over.work('value');
}`);
    const callerFunctions = extractFunctions(callerRoot, '/project/caller.ts');
    const overImport: ImportEntity = {
      id: 'imp-over',
      source: './over',
      filePath: '/project/caller.ts',
      isDefault: false,
      isNamespace: false,
      specifiers: [{ name: 'Over' }],
      resolvedPath: declarationFile,
    };
    const calls = extractCalls(
      callerRoot,
      '/project/caller.ts',
      callerFunctions,
      [overImport],
      false,
      [],
    );
    const receiverCall = calls.find((call) => call.calleeName === 'work');

    expect(receiverCall).toMatchObject({
      calleeClassName: 'Over',
      calleeFilePath: declarationFile,
    });
    const classQualifiedTargets = methodEdges
      .map((edge) => workFunctions.find((entity) => entity.id === edge.toId))
      .filter((entity) => entity?.name === receiverCall!.calleeName);
    expect(classQualifiedTargets).toEqual([implementation]);
  });

  it('receiver call to a locally declared class also carries calleeClassName', () => {
    const code = `
class Service {
  work() {}
}
class OtherService {
  work() {}
}

function run() {
  const s = new Service();
  s.work();
}
`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'app.ts');
    const classes = extractClasses(rootNode, 'app.ts');
    const calls = extractCalls(rootNode, 'app.ts', functions, [], false, classes);

    const ref = calls.find((c) => c.calleeName === 'work');
    expect(ref).toBeDefined();
    expect(ref!.calleeClassName).toBe('Service');
  });

  it('plain function calls never carry calleeClassName', () => {
    const code = `
function helper() {}
function main() { helper(); }
`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'main.ts');
    const calls = extractCalls(rootNode, 'main.ts', functions, []);

    const ref = calls.find((c) => c.calleeName === 'helper');
    expect(ref).toBeDefined();
    expect(ref!.calleeClassName).toBeUndefined();
  });

  it('resolvedImports rewrites an aliased receiver-typed class import to the origin-declared class name (reviewer blocker 4, class case)', () => {
    // import { Service as LocalService } from './barrel' where the barrel
    // re-exports Service under an alias: the class name searched for in the
    // graph must be the ORIGIN-declared name, not the local alias.
    const code = `
import { LocalService } from './barrel';

function run() {
  const s = new LocalService();
  s.work();
}
`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'app.ts');
    const mockImport: ImportEntity = {
      id: 'imp-1',
      source: './barrel',
      filePath: 'app.ts',
      isDefault: false,
      isNamespace: false,
      specifiers: [{ name: 'Service', alias: 'LocalService' }],
      resolvedPath: '/project/barrel.ts',
    };
    const resolvedImports = new Map<string, ResolvedImportTarget>([
      ['LocalService', { filePath: '/project/origin.ts', exportedName: 'Service' }],
    ]);
    const calls = extractCalls(rootNode, 'app.ts', functions, [mockImport], false, [], resolvedImports);

    const ref = calls.find((c) => c.calleeName === 'work');
    expect(ref).toBeDefined();
    expect(ref!.calleeFilePath).toBe('/project/origin.ts');
    expect(ref!.calleeClassName).toBe('Service');
  });

  it('resolvedImports rewrites an aliased direct function call to the origin-declared name (reviewer blocker 4, function case)', () => {
    const code = `
import { renamedFn } from './barrel';

function run() {
  renamedFn();
}
`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'app.ts');
    const mockImport: ImportEntity = {
      id: 'imp-1',
      source: './barrel',
      filePath: 'app.ts',
      isDefault: false,
      isNamespace: false,
      specifiers: [{ name: 'renamedFn' }],
      resolvedPath: '/project/barrel.ts',
    };
    const resolvedImports = new Map<string, ResolvedImportTarget>([
      ['renamedFn', { filePath: '/project/origin.ts', exportedName: 'aliasedFn' }],
    ]);
    const calls = extractCalls(rootNode, 'app.ts', functions, [mockImport], false, [], resolvedImports);

    const ref = calls.find((c) => c.callerName === 'run');
    expect(ref).toBeDefined();
    expect(ref!.calleeName).toBe('aliasedFn');
    expect(ref!.calleeFilePath).toBe('/project/origin.ts');
  });

  it('without resolvedImports, an aliased import call keeps the pre-fix behavior (local alias as calleeName)', () => {
    const code = `
import { renamedFn } from './barrel';
function run() { renamedFn(); }
`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'app.ts');
    const mockImport: ImportEntity = {
      id: 'imp-1',
      source: './barrel',
      filePath: 'app.ts',
      isDefault: false,
      isNamespace: false,
      specifiers: [{ name: 'renamedFn' }],
      resolvedPath: '/project/barrel.ts',
    };
    const calls = extractCalls(rootNode, 'app.ts', functions, [mockImport], false, []);

    const ref = calls.find((c) => c.callerName === 'run');
    expect(ref).toBeDefined();
    expect(ref!.calleeName).toBe('renamedFn');
    expect(ref!.calleeFilePath).toBe('/project/barrel.ts');
  });
});
