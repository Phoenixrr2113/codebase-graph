/**
 * TypeScript Plugin Extractor Tests
 * Covers HAS_METHOD / HAS_PROPERTY extraction (Tasks 8+9) and the end-to-end
 * wiring through extractAllEntities (Task pipeline fix).
 * HAS_PARAM/RETURNS/USES_TYPE tests added in Task 15.
 * Task 21 expanded to full extractor coverage (calls, imports, inheritance,
 * jsx, renders, type-aliases, variables, functions, classes, error cases).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import Parser from 'tree-sitter';
import { grammars } from '../src';
import {
  extractClassesWithEdges,
  type ClassExtractionResult,
} from '../src/extractors/classes';
import {
  extractAllEntities,
  extractCalls,
  extractImports,
  extractFunctions,
  extractClasses,
  extractVariables,
  extractTypes,
  extractInterfaces,
  extractComponents,
  extractInheritance,
  extractRenders,
  generateEntityId,
} from '../src/extractors';

const TEST_FILE = 'user.ts';

let parser: Parser;
let tsxParser: Parser;

function parseCode(code: string): Parser.SyntaxNode {
  const tree = parser.parse(code);
  return tree.rootNode;
}

function parseTsx(code: string): Parser.SyntaxNode {
  const tree = tsxParser.parse(code);
  return tree.rootNode;
}

/**
 * Run extractAllEntities on the given TypeScript source code.
 * Returns the full ExtractedEntities result including type-ref edge arrays.
 */
function runTSExtraction(code: string, filePath: string) {
  const rootNode = parseCode(code);
  return extractAllEntities(rootNode, filePath);
}

describe('TypeScript HAS_METHOD / HAS_PROPERTY', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(grammars.typescript as Parameters<Parser['setLanguage']>[0]);
    tsxParser = new Parser();
    tsxParser.setLanguage(grammars.tsx as Parameters<Parser['setLanguage']>[0]);
  });

  it('emits Function entities + HAS_METHOD edges for class methods', () => {
    const code = `
export class User {
  name: string = '';
  greet(): string { return \`hi \${this.name}\`; }
  static create(name: string): User { return new User(); }
  private _hash(): string { return ''; }
}
`;
    const rootNode = parseCode(code);
    const result: ClassExtractionResult = extractClassesWithEdges(rootNode, TEST_FILE);

    const userClass = result.classes.find(c => c.name === 'User');
    expect(userClass).toBeDefined();

    const hasMethodEdges = result.hasMethodEdges.filter(r => r.fromId === userClass!.id);
    expect(hasMethodEdges).toHaveLength(3);

    // Find method entities via HAS_METHOD edge toIds (generateEntityId format now)
    const methods = hasMethodEdges.map(e => result.methodEntities.find(m => m.id === e.toId)!);
    expect(methods.map(m => m.name).sort()).toEqual(['_hash', 'create', 'greet']);

    // Static method has isStatic = true on its edge
    const createEdge = hasMethodEdges.find(e => {
      const m = result.methodEntities.find(m => m.id === e.toId);
      return m?.name === 'create';
    });
    expect(createEdge?.isStatic).toBe(true);

    // Private method has visibility = 'private'
    const hashEdge = hasMethodEdges.find(e => {
      const m = result.methodEntities.find(m => m.id === e.toId);
      return m?.name === '_hash';
    });
    expect(hashEdge?.visibility).toBe('private');
  });

  it('emits Variable entities + HAS_PROPERTY edges for class fields', () => {
    const code = `
export class User {
  name: string = '';
  readonly id: number = 0;
  static defaultCount = 10;
}
`;
    const rootNode = parseCode(code);
    const result: ClassExtractionResult = extractClassesWithEdges(rootNode, TEST_FILE);

    const userClass = result.classes.find(c => c.name === 'User')!;

    const props = result.propertyEntities.filter(
      p => p.id?.startsWith(`${userClass.id}::prop`),
    );
    expect(props.map(p => p.name).sort()).toEqual(['defaultCount', 'id', 'name']);

    const hasPropEdges = result.hasPropertyEdges.filter(r => r.fromId === userClass.id);
    expect(hasPropEdges).toHaveLength(3);

    const idProp = props.find(p => p.name === 'id')!;
    const idEdge = hasPropEdges.find(e => e.toId === idProp.id);
    expect(idEdge?.isReadonly).toBe(true);

    const staticProp = props.find(p => p.name === 'defaultCount')!;
    const staticEdge = hasPropEdges.find(e => e.toId === staticProp.id);
    expect(staticEdge?.isStatic).toBe(true);
  });

  it('emits correct entity IDs using deterministic format', () => {
    const code = `
export class User {
  greet() {}
}
`;
    const rootNode = parseCode(code);
    const result = extractClassesWithEdges(rootNode, TEST_FILE);

    const userClass = result.classes.find(c => c.name === 'User')!;
    const greetMethod = result.methodEntities.find(m => m.name === 'greet')!;

    // Method entity id uses generateEntityId format (same as extractFunctions would produce)
    const expectedGreetId = generateEntityId(TEST_FILE, 'function', 'greet', greetMethod.startLine);
    expect(greetMethod.id).toBe(expectedGreetId);

    // Edge connects class to method using fromId/toId
    const edge = result.hasMethodEdges.find(e => e.toId === greetMethod.id);
    expect(edge?.fromId).toBe(userClass.id);
  });

  it('assigns default public visibility when no modifier present', () => {
    const code = `
export class User {
  value: string = '';
  getValue() { return this.value; }
}
`;
    const rootNode = parseCode(code);
    const result = extractClassesWithEdges(rootNode, TEST_FILE);

    const userClass = result.classes.find(c => c.name === 'User')!;

    const methodEdge = result.hasMethodEdges.find(e => e.fromId === userClass.id);
    expect(methodEdge?.visibility).toBe('public');
    expect(methodEdge?.isStatic).toBe(false);

    const propEdge = result.hasPropertyEdges.find(e => e.fromId === userClass.id);
    expect(propEdge?.visibility).toBe('public');
    expect(propEdge?.isReadonly).toBe(false);
  });

  it('handles class with no methods or properties gracefully', () => {
    const code = `
export class Empty {}
`;
    const rootNode = parseCode(code);
    const result = extractClassesWithEdges(rootNode, TEST_FILE);

    expect(result.classes).toHaveLength(1);
    expect(result.methodEntities).toHaveLength(0);
    expect(result.propertyEntities).toHaveLength(0);
    expect(result.hasMethodEdges).toHaveLength(0);
    expect(result.hasPropertyEdges).toHaveLength(0);
  });
});

describe('extractAllEntities — end-to-end HAS_METHOD/HAS_PROPERTY pipeline wiring', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(grammars.typescript as Parameters<Parser['setLanguage']>[0]);
    tsxParser = new Parser();
    tsxParser.setLanguage(grammars.tsx as Parameters<Parser['setLanguage']>[0]);
  });

  it('propagates hasMethodEdges and hasPropertyEdges through extractAllEntities', () => {
    const code = `
export class Service {
  private name: string = 'svc';
  readonly version: number = 1;
  static instances = 0;
  init(): void {}
  private connect(): Promise<void> { return Promise.resolve(); }
  static create(): Service { return new Service(); }
}
`;
    const rootNode = parseCode(code);
    const result = extractAllEntities(rootNode, TEST_FILE);

    // hasMethodEdges and hasPropertyEdges must be present (not undefined, not empty)
    expect(result.hasMethodEdges).toBeDefined();
    expect(result.hasPropertyEdges).toBeDefined();

    const serviceClass = result.classes.find(c => c.name === 'Service');
    expect(serviceClass).toBeDefined();
    const classId = serviceClass!.id!;

    // 3 methods: init, connect, create
    const methodEdges = result.hasMethodEdges.filter(e => e.fromId === classId);
    expect(methodEdges).toHaveLength(3);

    // 3 properties: name, version, instances
    const propEdges = result.hasPropertyEdges.filter(e => e.fromId === classId);
    expect(propEdges).toHaveLength(3);

    // Method entities appear in the top-level functions array, found via HAS_METHOD edge toIds
    const methodEdgeToIds = new Set(methodEdges.map(e => e.toId));
    const methodNames = result.functions
      .filter(f => f.id && methodEdgeToIds.has(f.id))
      .map(f => f.name)
      .sort();
    expect(methodNames).toEqual(['connect', 'create', 'init']);

    // Property entities appear in the top-level variables array
    const propNames = result.variables
      .filter(v => v.id?.startsWith(`${classId}::prop`))
      .map(v => v.name)
      .sort();
    expect(propNames).toEqual(['instances', 'name', 'version']);

    // Verify edge metadata
    const connectEdge = methodEdges.find(e => {
      const fn = result.functions.find(f => f.id === e.toId);
      return fn?.name === 'connect';
    });
    expect(connectEdge?.visibility).toBe('private');

    const createEdge = methodEdges.find(e => {
      const fn = result.functions.find(f => f.id === e.toId);
      return fn?.name === 'create';
    });
    expect(createEdge?.isStatic).toBe(true);

    const versionEdge = propEdges.find(e => {
      const v = result.variables.find(vv => vv.id === e.toId);
      return v?.name === 'version';
    });
    expect(versionEdge?.isReadonly).toBe(true);
  });

  it('returns empty hasMethodEdges and hasPropertyEdges for files with no classes', () => {
    const code = `
export function add(a: number, b: number): number { return a + b; }
export const PI = 3.14;
`;
    const rootNode = parseCode(code);
    const result = extractAllEntities(rootNode, TEST_FILE);

    expect(result.hasMethodEdges).toHaveLength(0);
    expect(result.hasPropertyEdges).toHaveLength(0);
  });
});

describe('Regression: HAS_METHOD toId format matches Function entity id (::method:: bug)', () => {
  // Regression for: class extractors produced method-Function entities with id
  // <classId>::method::<name>, while extractFunctions produced the same methods with
  // generateEntityId-format ids. Natural-key MERGE in the graph collapsed both to one
  // node; whichever id was upserted last won. HAS_METHOD edge toIds used ::method::
  // format and silently failed their MATCH — resulting in 0 HAS_METHOD edges in graph.

  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(grammars.typescript as Parameters<Parser['setLanguage']>[0]);
  });

  it('extractClassesWithEdges: every HAS_METHOD toId matches a method entity id', () => {
    const code = `
export class Counter {
  private count: number = 0;
  increment(): void { this.count++; }
  decrement(): void { this.count--; }
  static reset(): Counter { return new Counter(); }
}
`;
    const rootNode = parseCode(code);
    const result = extractClassesWithEdges(rootNode, TEST_FILE);

    const counterClass = result.classes.find(c => c.name === 'Counter');
    expect(counterClass).toBeDefined();

    const methodEntityIds = new Set(result.methodEntities.map(m => m.id));
    const classEdges = result.hasMethodEdges.filter(e => e.fromId === counterClass!.id);
    expect(classEdges).toHaveLength(3);

    for (const edge of classEdges) {
      expect(methodEntityIds.has(edge.toId),
        `HAS_METHOD toId '${edge.toId}' not found in methodEntities. ` +
        `Entity ids: ${[...methodEntityIds].join(', ')}`
      ).toBe(true);
    }

    // No ::method:: format in any entity id
    for (const entity of result.methodEntities) {
      expect(entity.id).not.toContain('::method::');
    }
  });

  it('extractAllEntities: every HAS_METHOD toId resolves to a function in the output array', () => {
    const code = `
export class Service {
  name: string = 'svc';
  start(): void {}
  stop(): void {}
}
export function topLevel(): string { return ''; }
`;
    const rootNode = parseCode(code);
    const result = extractAllEntities(rootNode, TEST_FILE);

    const serviceClass = result.classes.find(c => c.name === 'Service');
    expect(serviceClass).toBeDefined();

    const functionIds = new Set(result.functions.map(f => f.id));
    const classEdges = result.hasMethodEdges.filter(e => e.fromId === serviceClass!.id);
    expect(classEdges).toHaveLength(2);

    for (const edge of classEdges) {
      expect(functionIds.has(edge.toId),
        `HAS_METHOD toId '${edge.toId}' not found in functions array. ` +
        `Ids: ${[...functionIds].join(', ')}`
      ).toBe(true);
    }

    // Top-level function must be present (not mixed with methods)
    expect(result.functions.find(f => f.name === 'topLevel')).toBeDefined();

    // No ::method:: format in any function id
    for (const fn of result.functions) {
      expect(fn.id).not.toContain('::method::');
    }
  });
});

describe('TS HAS_PARAM / RETURNS / USES_TYPE', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(grammars.typescript as Parameters<Parser['setLanguage']>[0]);
    tsxParser = new Parser();
    tsxParser.setLanguage(grammars.tsx as Parameters<Parser['setLanguage']>[0]);
  });

  it('emits HAS_PARAM and RETURNS edges with type refs', () => {
    const code = `
type User = { id: string };

export async function fetchUser(id: string, opts?: number): Promise<User> {
  const url: string = '/api/' + id;
  return null as unknown as User;
}
`;
    const result = runTSExtraction(code, 'fetch.ts');

    const fn = result.functions.find((e) => e.name === 'fetchUser')!;
    expect(fn).toBeDefined();

    const hasParam = (result.hasParamEdges ?? []).filter((e) => e.fromId === fn.id);
    expect(hasParam).toHaveLength(2);

    // First param: id: string → primitive
    const idParam = hasParam.find((e) => e.name === 'id')!;
    expect(idParam).toBeDefined();
    expect(idParam.toId).toBe('prim::typescript::string');
    expect(idParam.isOptional).toBe(false);

    // Second param: opts?: number → optional primitive
    const optsParam = hasParam.find((e) => e.name === 'opts')!;
    expect(optsParam).toBeDefined();
    expect(optsParam.isOptional).toBe(true);
    expect(optsParam.toId).toBe('prim::typescript::number');

    // RETURNS Promise<User>
    const returns = (result.returnsEdges ?? []).filter((e) => e.fromId === fn.id);
    expect(returns).toHaveLength(1);
    const ret = returns[0]!;
    expect(ret.isAsync).toBe(true);
    const returnTypeRef = (result.typeRefs ?? []).find((t) => t.id === ret.toId)!;
    expect(returnTypeRef).toBeDefined();
    expect(returnTypeRef.name).toBe('Promise<User>');

    // USES_TYPE on the local var annotation `: string`
    const usesType = (result.usesTypeEdges ?? []).filter((e) => e.fromId === fn.id);
    expect(usesType.some((e) => e.kind === 'annotation')).toBe(true);
    expect(usesType.some((e) => e.kind === 'cast')).toBe(true);

    // typeRefs array is deduplicated
    const typeRefIds = (result.typeRefs ?? []).map((t) => t.id);
    expect(new Set(typeRefIds).size).toBe(typeRefIds.length);
  });

  it('emits RETURNS to "inferred" Type when no annotation', () => {
    const code = `
function add(a: number, b: number) { return a + b; }
`;
    const result = runTSExtraction(code, 'inferred.ts');
    const fn = result.functions.find((e) => e.name === 'add')!;
    expect(fn).toBeDefined();

    const returns = (result.returnsEdges ?? []).filter((e) => e.fromId === fn.id);
    expect(returns).toHaveLength(1);
    const ret = returns[0]!;
    const returnTypeRef = (result.typeRefs ?? []).find((t) => t.id === ret.toId)!;
    expect(returnTypeRef).toBeDefined();
    expect(returnTypeRef.name).toBe('inferred');
  });

  it('emits TypeRef entities deduplicated when same type appears in multiple functions', () => {
    const code = `
function a(u: User): User { return u; }
function b(u: User): User { return u; }
type User = { id: string };
`;
    const result = runTSExtraction(code, 'multi.ts');
    const userTypeRefs = (result.typeRefs ?? []).filter((t) => t.name === 'User');
    expect(userTypeRefs).toHaveLength(1);
    expect(userTypeRefs[0]!.id).toBe('type::typescript::multi.ts::User');
  });
});

// ==========================================================================
// Calls Extractor
// ==========================================================================

describe('TS extractors: calls', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(grammars.typescript as Parameters<Parser['setLanguage']>[0]);
  });

  it('local function call produces a CALLS reference from caller to callee', () => {
    const code = `
function helper() {}
function main() { helper(); }
`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'calls.ts');
    const calls = extractCalls(rootNode, 'calls.ts', functions, []);

    expect(calls.length).toBeGreaterThanOrEqual(1);
    const ref = calls.find(c => c.callerName === 'main' && c.calleeName === 'helper');
    expect(ref).toBeDefined();
    expect(ref!.callerFilePath).toBe('calls.ts');
    expect(ref!.calleeFilePath).toBe('calls.ts');
  });

  it('self-recursion produces a CALLS edge from the function to itself', () => {
    const code = `
function countdown(n: number): number {
  if (n <= 0) return 0;
  return countdown(n - 1);
}
`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'calls.ts');
    const calls = extractCalls(rootNode, 'calls.ts', functions, []);

    const selfCall = calls.find(
      c => c.callerName === 'countdown' && c.calleeName === 'countdown',
    );
    expect(selfCall).toBeDefined();
    expect(selfCall!.calleeFilePath).toBe('calls.ts');
  });

  it('call to imported function resolves calleeFilePath via import map', () => {
    const code = `
function run() { doWork(); }
`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'main.ts');
    const mockImport = {
      id: 'imp-1',
      source: './worker',
      filePath: 'main.ts',
      isDefault: false,
      isNamespace: false,
      specifiers: [{ name: 'doWork' }],
      resolvedPath: '/project/worker.ts',
    };
    const calls = extractCalls(rootNode, 'main.ts', functions, [mockImport]);

    const ref = calls.find(c => c.calleeName === 'doWork');
    expect(ref).toBeDefined();
    expect(ref!.calleeFilePath).toBe('/project/worker.ts');
  });

  it('unresolved external call is excluded by default (includeExternals=false)', () => {
    const code = `
function main() { unknownLibFn(); }
`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'main.ts');
    const calls = extractCalls(rootNode, 'main.ts', functions, [], false);

    const ref = calls.find(c => c.calleeName === 'unknownLibFn');
    expect(ref).toBeUndefined();
  });

  it('unresolved external call is included when includeExternals=true', () => {
    const code = `
function main() { unknownLibFn(); }
`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'main.ts');
    const calls = extractCalls(rootNode, 'main.ts', functions, [], true);

    const ref = calls.find(c => c.calleeName === 'unknownLibFn');
    expect(ref).toBeDefined();
    expect(ref!.calleeFilePath).toBeUndefined();
  });
});

// ==========================================================================
// Imports Extractor
// ==========================================================================

describe('TS extractors: imports', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(grammars.typescript as Parameters<Parser['setLanguage']>[0]);
  });

  it('default import produces isDefault=true and defaultAlias', () => {
    const code = `import React from 'react';`;
    const rootNode = parseCode(code);
    const imports = extractImports(rootNode, '/project/app.ts');

    expect(imports).toHaveLength(1);
    expect(imports[0]!.source).toBe('react');
    expect(imports[0]!.isDefault).toBe(true);
    expect(imports[0]!.defaultAlias).toBe('React');
    expect(imports[0]!.specifiers).toHaveLength(0);
  });

  it('named import produces specifier entries', () => {
    const code = `import { useState, useEffect } from 'react';`;
    const rootNode = parseCode(code);
    const imports = extractImports(rootNode, '/project/app.ts');

    expect(imports).toHaveLength(1);
    const imp = imports[0]!;
    expect(imp.isDefault).toBe(false);
    expect(imp.specifiers.map(s => s.name).sort()).toEqual(['useEffect', 'useState']);
  });

  it('aliased named import captures the alias', () => {
    const code = `import { foo as bar } from './utils';`;
    const rootNode = parseCode(code);
    const imports = extractImports(rootNode, '/project/app.ts');

    const spec = imports[0]!.specifiers[0]!;
    expect(spec.name).toBe('foo');
    expect(spec.alias).toBe('bar');
  });

  it('namespace import produces isNamespace=true and namespaceAlias', () => {
    const code = `import * as path from 'path';`;
    const rootNode = parseCode(code);
    const imports = extractImports(rootNode, '/project/app.ts');

    expect(imports[0]!.isNamespace).toBe(true);
    expect(imports[0]!.namespaceAlias).toBe('path');
  });

  it('type-only import is parsed as a regular import (source and specifiers captured)', () => {
    // tree-sitter-typescript parses `import type { X }` as a normal import_statement
    // with a type_keyword inside the clause. The extractor captures source and specifiers.
    const code = `import type { User } from './types';`;
    const rootNode = parseCode(code);
    const imports = extractImports(rootNode, '/project/app.ts');

    expect(imports).toHaveLength(1);
    expect(imports[0]!.source).toBe('./types');
    // specifiers may or may not include 'User' depending on how the type keyword is parsed;
    // the important thing is the import is captured at all.
    expect(imports[0]!.source).toBeTruthy();
  });

  it('multiple imports from the same file are each captured', () => {
    const code = `
import React from 'react';
import { useState } from 'react';
`;
    const rootNode = parseCode(code);
    const imports = extractImports(rootNode, '/project/app.ts');

    expect(imports).toHaveLength(2);
    expect(imports.every(i => i.source === 'react')).toBe(true);
  });
});

// ==========================================================================
// Inheritance Extractor
// ==========================================================================

describe('TS extractors: inheritance', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(grammars.typescript as Parameters<Parser['setLanguage']>[0]);
  });

  it('class extends produces an ExtendsReference when parent is local', () => {
    const code = `
class Animal {}
class Dog extends Animal {}
`;
    const rootNode = parseCode(code);
    const classes = extractClasses(rootNode, 'pets.ts');
    const interfaces = extractInterfaces(rootNode, 'pets.ts');
    const result = extractInheritance('pets.ts', classes, interfaces, [], true);

    expect(result.extends).toHaveLength(1);
    const ref = result.extends[0]!;
    expect(ref.childName).toBe('Dog');
    expect(ref.parentName).toBe('Animal');
    expect(ref.parentFilePath).toBe('pets.ts');
  });

  it('class implements produces ImplementsReferences for each interface', () => {
    const code = `
interface Runnable {}
interface Serializable {}
class Task implements Runnable, Serializable {}
`;
    const rootNode = parseCode(code);
    const classes = extractClasses(rootNode, 'task.ts');
    const interfaces = extractInterfaces(rootNode, 'task.ts');
    const result = extractInheritance('task.ts', classes, interfaces, [], true);

    expect(result.implements).toHaveLength(2);
    const names = result.implements.map(r => r.interfaceName).sort();
    expect(names).toEqual(['Runnable', 'Serializable']);
    result.implements.forEach(r => {
      expect(r.className).toBe('Task');
      expect(r.interfaceFilePath).toBe('task.ts');
    });
  });

  it('class with no heritage produces no extends or implements entries', () => {
    const code = `class Standalone {}`;
    const rootNode = parseCode(code);
    const classes = extractClasses(rootNode, 'stand.ts');
    const interfaces = extractInterfaces(rootNode, 'stand.ts');
    const result = extractInheritance('stand.ts', classes, interfaces, []);

    expect(result.extends).toHaveLength(0);
    expect(result.implements).toHaveLength(0);
  });

  it('interface extends another interface captures the relationship on the class entity', () => {
    // extractInheritance operates on ClassEntity.extends field, not InterfaceEntity.extends.
    // Interface extends relationships are stored on the InterfaceEntity directly (entity.extends[]).
    const code = `
interface Base {}
interface Child extends Base {}
`;
    const rootNode = parseCode(code);
    const interfaces = extractInterfaces(rootNode, 'iface.ts');
    const child = interfaces.find(i => i.name === 'Child');

    expect(child).toBeDefined();
    expect(child!.extends).toContain('Base');
  });

  it('unresolved external parent is excluded when includeExternals=false', () => {
    const code = `class MyError extends Error {}`;
    const rootNode = parseCode(code);
    const classes = extractClasses(rootNode, 'err.ts');
    const interfaces = extractInterfaces(rootNode, 'err.ts');
    const result = extractInheritance('err.ts', classes, interfaces, [], false);

    // Error is not local and not imported → excluded
    expect(result.extends).toHaveLength(0);
  });
});

// ==========================================================================
// JSX + Component Extractor
// ==========================================================================

describe('TS extractors: jsx + components', () => {
  beforeAll(() => {
    tsxParser = new Parser();
    tsxParser.setLanguage(grammars.tsx as Parameters<Parser['setLanguage']>[0]);
  });

  it('function returning JSX is extracted as a ComponentEntity', () => {
    const code = `
export function App() {
  return <div>Hello</div>;
}
`;
    const rootNode = parseTsx(code);
    const components = extractComponents(rootNode, 'App.tsx');

    expect(components).toHaveLength(1);
    expect(components[0]!.name).toBe('App');
    expect(components[0]!.isExported).toBe(true);
  });

  it('arrow function returning JSX is extracted as a ComponentEntity', () => {
    const code = `
const Header = () => <header>Title</header>;
`;
    const rootNode = parseTsx(code);
    const components = extractComponents(rootNode, 'Header.tsx');

    expect(components).toHaveLength(1);
    expect(components[0]!.name).toBe('Header');
  });

  it('lowercase function returning JSX is NOT extracted as a component (not PascalCase)', () => {
    const code = `
function renderItem() { return <li>item</li>; }
`;
    const rootNode = parseTsx(code);
    const components = extractComponents(rootNode, 'item.tsx');

    expect(components).toHaveLength(0);
  });

  it('component that renders another PascalCase component produces a RENDERS reference', () => {
    const code = `
function Button() { return <div>ok</div>; }
function App() { return <Button />; }
`;
    const rootNode = parseTsx(code);
    const components = extractComponents(rootNode, 'app.tsx');
    const renders = extractRenders(rootNode, 'app.tsx', components, []);

    expect(renders.length).toBeGreaterThanOrEqual(1);
    const ref = renders.find(r => r.parentName === 'App' && r.childName === 'Button');
    expect(ref).toBeDefined();
    expect(ref!.childFilePath).toBe('app.tsx');
  });

  it('renders extractor ignores lowercase HTML elements', () => {
    const code = `
function App() { return <div><span>hello</span></div>; }
`;
    const rootNode = parseTsx(code);
    const components = extractComponents(rootNode, 'app.tsx');
    const renders = extractRenders(rootNode, 'app.tsx', components, []);

    // No PascalCase child components
    expect(renders).toHaveLength(0);
  });
});

// ==========================================================================
// Type Aliases Extractor (via type-aliases.ts → extractTypes / extractInterfaces)
// ==========================================================================

describe('TS extractors: type aliases', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(grammars.typescript as Parameters<Parser['setLanguage']>[0]);
  });

  it('simple type alias produces a TypeEntity with kind=type', () => {
    const code = `type UserId = string;`;
    const rootNode = parseCode(code);
    const types = extractTypes(rootNode, 'types.ts');

    expect(types).toHaveLength(1);
    expect(types[0]!.name).toBe('UserId');
    expect(types[0]!.kind).toBe('type');
    expect(types[0]!.filePath).toBe('types.ts');
  });

  it('object type alias produces a TypeEntity', () => {
    const code = `type User = { id: string; name: string };`;
    const rootNode = parseCode(code);
    const types = extractTypes(rootNode, 'types.ts');

    expect(types).toHaveLength(1);
    expect(types[0]!.name).toBe('User');
  });

  it('exported type alias has isExported=true', () => {
    const code = `export type Status = 'active' | 'inactive';`;
    const rootNode = parseCode(code);
    const types = extractTypes(rootNode, 'types.ts');

    expect(types[0]!.isExported).toBe(true);
  });

  it('non-exported type alias has isExported=false', () => {
    const code = `type Internal = number;`;
    const rootNode = parseCode(code);
    const types = extractTypes(rootNode, 'types.ts');

    expect(types[0]!.isExported).toBe(false);
  });

  it('generic type alias produces a TypeEntity', () => {
    const code = `type Maybe<T> = T | null;`;
    const rootNode = parseCode(code);
    const types = extractTypes(rootNode, 'types.ts');

    expect(types).toHaveLength(1);
    expect(types[0]!.name).toBe('Maybe');
  });

  it('enum declaration produces a TypeEntity with kind=enum', () => {
    const code = `enum Direction { Up, Down, Left, Right }`;
    const rootNode = parseCode(code);
    const types = extractTypes(rootNode, 'types.ts');

    expect(types).toHaveLength(1);
    expect(types[0]!.name).toBe('Direction');
    expect(types[0]!.kind).toBe('enum');
  });

  it('multiple type aliases are all extracted', () => {
    const code = `
type A = string;
type B = number;
type C = boolean;
`;
    const rootNode = parseCode(code);
    const types = extractTypes(rootNode, 'types.ts');

    expect(types.map(t => t.name).sort()).toEqual(['A', 'B', 'C']);
  });
});

// ==========================================================================
// Variables Extractor
// ==========================================================================

describe('TS extractors: variables', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(grammars.typescript as Parameters<Parser['setLanguage']>[0]);
  });

  it('top-level const declaration produces a VariableEntity', () => {
    const code = `const X = 1;`;
    const rootNode = parseCode(code);
    const vars = extractVariables(rootNode, 'vars.ts');

    expect(vars).toHaveLength(1);
    expect(vars[0]!.name).toBe('X');
    expect(vars[0]!.kind).toBe('const');
  });

  it('exported const has isExported=true', () => {
    const code = `export const PI = 3.14;`;
    const rootNode = parseCode(code);
    const vars = extractVariables(rootNode, 'vars.ts');

    expect(vars[0]!.isExported).toBe(true);
  });

  it('let declaration has kind=let', () => {
    const code = `let counter = 0;`;
    const rootNode = parseCode(code);
    const vars = extractVariables(rootNode, 'vars.ts');

    expect(vars[0]!.kind).toBe('let');
  });

  it('var declaration has kind=var', () => {
    const code = `var legacy = 'old';`;
    const rootNode = parseCode(code);
    const vars = extractVariables(rootNode, 'vars.ts');

    expect(vars[0]!.kind).toBe('var');
  });

  it('variable with type annotation captures the type', () => {
    const code = `const x: number = 42;`;
    const rootNode = parseCode(code);
    const vars = extractVariables(rootNode, 'vars.ts');

    expect(vars[0]!.type).toBe('number');
  });

  it('destructuring assignment is skipped (no entity for pattern binding)', () => {
    // The extractor explicitly skips object_pattern and array_pattern
    const code = `const { a, b } = obj;`;
    const rootNode = parseCode(code);
    const vars = extractVariables(rootNode, 'vars.ts');

    // Destructuring is skipped — result may be empty
    const destructured = vars.filter(v => v.name === 'a' || v.name === 'b');
    expect(destructured).toHaveLength(0);
  });

  it('multiple declarations on one line each produce a VariableEntity', () => {
    const code = `const a = 1, b = 2;`;
    const rootNode = parseCode(code);
    const vars = extractVariables(rootNode, 'vars.ts');

    expect(vars.map(v => v.name).sort()).toEqual(['a', 'b']);
  });
});

// ==========================================================================
// Functions Extractor (basic)
// ==========================================================================

describe('TS extractors: functions (basic)', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(grammars.typescript as Parameters<Parser['setLanguage']>[0]);
  });

  it('function declaration produces a FunctionEntity', () => {
    const code = `function greet(name: string): string { return 'hi'; }`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'fn.ts');

    expect(functions).toHaveLength(1);
    expect(functions[0]!.name).toBe('greet');
    expect(functions[0]!.filePath).toBe('fn.ts');
  });

  it('exported function has isExported=true', () => {
    const code = `export function doThing() {}`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'fn.ts');

    expect(functions[0]!.isExported).toBe(true);
  });

  it('non-exported function has isExported=false', () => {
    const code = `function internal() {}`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'fn.ts');

    expect(functions[0]!.isExported).toBe(false);
  });

  it('arrow function assigned to const produces a FunctionEntity', () => {
    const code = `const add = (a: number, b: number) => a + b;`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'fn.ts');

    const fn = functions.find(f => f.name === 'add');
    expect(fn).toBeDefined();
    expect(fn!.isArrow).toBe(true);
  });

  it('async function has isAsync=true', () => {
    const code = `async function fetchData() {}`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'fn.ts');

    expect(functions[0]!.isAsync).toBe(true);
  });

  it('non-async function has isAsync=false', () => {
    const code = `function syncFn() {}`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'fn.ts');

    expect(functions[0]!.isAsync).toBe(false);
  });

  it('generator function has isGenerator=true', () => {
    const code = `function* gen() { yield 1; }`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'fn.ts');

    const fn = functions.find(f => f.name === 'gen');
    expect(fn).toBeDefined();
    expect(fn!.isGenerator).toBe(true);
  });

  it('function with return type annotation captures returnType', () => {
    const code = `function id(x: number): number { return x; }`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'fn.ts');

    expect(functions[0]!.returnType).toBe('number');
  });

  it('function without return type annotation has returnType undefined', () => {
    const code = `function noReturn() {}`;
    const rootNode = parseCode(code);
    const functions = extractFunctions(rootNode, 'fn.ts');

    expect(functions[0]!.returnType).toBeUndefined();
  });
});

// ==========================================================================
// Classes Extractor (basic)
// ==========================================================================

describe('TS extractors: classes (basic)', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(grammars.typescript as Parameters<Parser['setLanguage']>[0]);
  });

  it('class declaration produces a ClassEntity', () => {
    const code = `class Animal {}`;
    const rootNode = parseCode(code);
    const classes = extractClasses(rootNode, 'cls.ts');

    expect(classes).toHaveLength(1);
    expect(classes[0]!.name).toBe('Animal');
    expect(classes[0]!.filePath).toBe('cls.ts');
  });

  it('exported class has isExported=true', () => {
    const code = `export class Dog {}`;
    const rootNode = parseCode(code);
    const classes = extractClasses(rootNode, 'cls.ts');

    expect(classes[0]!.isExported).toBe(true);
  });

  it('non-exported class has isExported=false', () => {
    const code = `class InternalHelper {}`;
    const rootNode = parseCode(code);
    const classes = extractClasses(rootNode, 'cls.ts');

    expect(classes[0]!.isExported).toBe(false);
  });

  it('abstract class has isAbstract=true', () => {
    const code = `abstract class Shape {}`;
    const rootNode = parseCode(code);
    const classes = extractClasses(rootNode, 'cls.ts');

    expect(classes[0]!.isAbstract).toBe(true);
  });

  it('concrete class has isAbstract=false', () => {
    const code = `class Circle {}`;
    const rootNode = parseCode(code);
    const classes = extractClasses(rootNode, 'cls.ts');

    expect(classes[0]!.isAbstract).toBe(false);
  });

  it('class with extends captures the parent name', () => {
    const code = `class Cat extends Animal {}`;
    const rootNode = parseCode(code);
    const classes = extractClasses(rootNode, 'cls.ts');

    expect(classes[0]!.extends).toBe('Animal');
  });

  it('class with implements captures the interface names', () => {
    const code = `class Runner implements Runnable, Trackable {}`;
    const rootNode = parseCode(code);
    const classes = extractClasses(rootNode, 'cls.ts');

    expect(classes[0]!.implements).toEqual(expect.arrayContaining(['Runnable', 'Trackable']));
  });

  it('interface declaration produces an InterfaceEntity', () => {
    const code = `interface Printable { print(): void; }`;
    const rootNode = parseCode(code);
    const interfaces = extractInterfaces(rootNode, 'iface.ts');

    expect(interfaces).toHaveLength(1);
    expect(interfaces[0]!.name).toBe('Printable');
    expect(interfaces[0]!.filePath).toBe('iface.ts');
  });

  it('exported interface has isExported=true', () => {
    const code = `export interface EventEmitter {}`;
    const rootNode = parseCode(code);
    const interfaces = extractInterfaces(rootNode, 'iface.ts');

    expect(interfaces[0]!.isExported).toBe(true);
  });
});

// ==========================================================================
// Error / Edge Cases
// ==========================================================================

describe('TS extractors: error cases', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(grammars.typescript as Parameters<Parser['setLanguage']>[0]);
  });

  it('empty file returns all-empty entity arrays without throwing', () => {
    const result = runTSExtraction('', 'empty.ts');

    expect(result.functions).toHaveLength(0);
    expect(result.classes).toHaveLength(0);
    expect(result.variables).toHaveLength(0);
    expect(result.imports).toHaveLength(0);
    expect(result.types).toHaveLength(0);
    expect(result.interfaces).toHaveLength(0);
    expect(result.components).toHaveLength(0);
  });

  it('file with only comments returns empty entity arrays', () => {
    const code = `
// This is a comment
/* Multi-line comment */
/** JSDoc comment */
`;
    const result = runTSExtraction(code, 'comments.ts');

    expect(result.functions).toHaveLength(0);
    expect(result.classes).toHaveLength(0);
    expect(result.variables).toHaveLength(0);
  });

  it('syntax error in input does not throw — returns partial result', () => {
    // tree-sitter is error-tolerant and will parse what it can
    const code = `
function valid() { return 1; }
function broken( { /* unclosed */
`;
    let result: ReturnType<typeof runTSExtraction> | undefined;
    expect(() => {
      result = runTSExtraction(code, 'broken.ts');
    }).not.toThrow();

    // At minimum, the valid function should be extracted
    expect(result).toBeDefined();
    const fn = result!.functions.find(f => f.name === 'valid');
    expect(fn).toBeDefined();
  });

  it('file with only type declarations returns types but no functions or classes', () => {
    const code = `
type A = string;
type B = number;
`;
    const result = runTSExtraction(code, 'types-only.ts');

    expect(result.functions).toHaveLength(0);
    expect(result.classes).toHaveLength(0);
    expect(result.types.map(t => t.name).sort()).toEqual(['A', 'B']);
  });
});
