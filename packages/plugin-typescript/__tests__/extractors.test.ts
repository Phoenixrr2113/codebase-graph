/**
 * TypeScript Plugin Extractor Tests
 * Covers HAS_METHOD / HAS_PROPERTY extraction (Tasks 8+9) and the end-to-end
 * wiring through extractAllEntities (Task pipeline fix).
 * HAS_PARAM/RETURNS/USES_TYPE tests added in Task 15.
 * Task 21 will expand to full extractor coverage.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import Parser from 'tree-sitter';
import { grammars } from '../src';
import {
  extractClassesWithEdges,
  type ClassExtractionResult,
} from '../src/extractors/classes';
import { extractAllEntities } from '../src/extractors';

const TEST_FILE = 'user.ts';

let parser: Parser;

function parseCode(code: string): Parser.SyntaxNode {
  const tree = parser.parse(code);
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

    const methods = result.methodEntities.filter(
      m => m.id.startsWith(`${userClass!.id}::method`),
    );
    expect(methods.map(m => m.name).sort()).toEqual(['_hash', 'create', 'greet']);

    const hasMethodEdges = result.hasMethodEdges.filter(r => r.fromId === userClass!.id);
    expect(hasMethodEdges).toHaveLength(3);

    // Static method has isStatic = true on its edge
    const createMethod = methods.find(m => m.name === 'create')!;
    const createEdge = hasMethodEdges.find(e => e.toId === createMethod.id);
    expect(createEdge?.isStatic).toBe(true);

    // Private method has visibility = 'private'
    const hashMethod = methods.find(m => m.name === '_hash')!;
    const hashEdge = hasMethodEdges.find(e => e.toId === hashMethod.id);
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

    // Method entity id is deterministic
    expect(greetMethod.id).toBe(`${userClass.id}::method::greet`);

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

    // Method entities appear in the top-level functions array
    const methodNames = result.functions
      .filter(f => f.id?.startsWith(`${classId}::method`))
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

describe('TS HAS_PARAM / RETURNS / USES_TYPE', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(grammars.typescript as Parameters<Parser['setLanguage']>[0]);
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
