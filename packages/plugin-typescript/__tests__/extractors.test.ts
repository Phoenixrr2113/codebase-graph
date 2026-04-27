/**
 * TypeScript Plugin Extractor Tests
 * First TS plugin test file — covers HAS_METHOD / HAS_PROPERTY extraction.
 * Task 15 will add HAS_PARAM/RETURNS/USES_TYPE tests.
 * Task 21 will expand to full extractor coverage.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import Parser from 'tree-sitter';
import { grammars } from '../src';
import {
  extractClassesWithEdges,
  type ClassExtractionResult,
} from '../src/extractors/classes';

const TEST_FILE = 'user.ts';

let parser: Parser;

function parseCode(code: string): Parser.SyntaxNode {
  const tree = parser.parse(code);
  return tree.rootNode;
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

    const hasMethodEdges = result.hasMethodEdges.filter(r => r.from === userClass!.id);
    expect(hasMethodEdges).toHaveLength(3);

    // Static method has isStatic = true on its edge
    const createMethod = methods.find(m => m.name === 'create')!;
    const createEdge = hasMethodEdges.find(e => e.to === createMethod.id);
    expect(createEdge?.isStatic).toBe(true);

    // Private method has visibility = 'private'
    const hashMethod = methods.find(m => m.name === '_hash')!;
    const hashEdge = hasMethodEdges.find(e => e.to === hashMethod.id);
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

    const hasPropEdges = result.hasPropertyEdges.filter(r => r.from === userClass.id);
    expect(hasPropEdges).toHaveLength(3);

    const idProp = props.find(p => p.name === 'id')!;
    const idEdge = hasPropEdges.find(e => e.to === idProp.id);
    expect(idEdge?.isReadonly).toBe(true);

    const staticProp = props.find(p => p.name === 'defaultCount')!;
    const staticEdge = hasPropEdges.find(e => e.to === staticProp.id);
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

    // Edge connects class to method
    const edge = result.hasMethodEdges.find(e => e.to === greetMethod.id);
    expect(edge?.from).toBe(userClass.id);
    expect(edge?.type).toBe('HAS_METHOD');
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

    const methodEdge = result.hasMethodEdges.find(e => e.from === userClass.id);
    expect(methodEdge?.visibility).toBe('public');
    expect(methodEdge?.isStatic).toBe(false);

    const propEdge = result.hasPropertyEdges.find(e => e.from === userClass.id);
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
