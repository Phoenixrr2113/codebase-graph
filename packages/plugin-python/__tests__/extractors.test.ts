/**
 * Python Plugin Unit Tests
 * Tests for entity extraction from Python syntax trees
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import {
  extractClasses,
  extractFunctions,
  extractVariables,
  extractImports,
  extractInheritance,
  extractCalls,
  extractAllEntities,
} from '../src';

const TEST_FILE = '/test/module.py';

let parser: Parser;

function parseCode(code: string): Parser.SyntaxNode {
  const tree = parser.parse(code);
  return tree.rootNode;
}

describe('Python Extractors', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(Python as any);
  });

  afterAll(() => {
    // Parser cleanup if needed
  });

  // ==========================================================================
  // Function Extraction
  // ==========================================================================

  describe('extractFunctions', () => {
    it('should extract basic function definitions', () => {
      const code = `
def greet(name):
    return f"Hello {name}"
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('greet');
      expect(functions[0].filePath).toBe(TEST_FILE);
      expect(functions[0].isExported).toBe(true);
      expect(functions[0].isAsync).toBe(false);
    });

    it('should extract typed parameters and return types', () => {
      const code = `
def add(a: int, b: int) -> int:
    return a + b
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].params).toEqual([
        { name: 'a', type: 'int' },
        { name: 'b', type: 'int' },
      ]);
      expect(functions[0].returnType).toBe('int');
    });

    it('should extract optional parameters with defaults', () => {
      const code = `
def fetch_data(url: str, timeout: int = 30, retries: int = 3):
    pass
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].params).toHaveLength(3);
      expect(functions[0].params[0]).toEqual({ name: 'url', type: 'str' });
      expect(functions[0].params[1]).toEqual({ name: 'timeout', type: 'int', optional: true });
      expect(functions[0].params[2]).toEqual({ name: 'retries', type: 'int', optional: true });
    });

    it('should extract async functions', () => {
      const code = `
async def fetch_data(url: str) -> dict:
    pass
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('fetch_data');
      expect(functions[0].isAsync).toBe(true);
    });

    it('should extract docstrings', () => {
      const code = `
def greet(name: str) -> str:
    """Say hello to someone."""
    return f"Hello {name}"
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].docstring).toBe('Say hello to someone.');
    });

    it('should mark private functions as not exported', () => {
      const code = `
def public_func():
    pass

def _private_func():
    pass

def __dunder_func__():
    pass
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(3);
      expect(functions[0].name).toBe('public_func');
      expect(functions[0].isExported).toBe(true);
      expect(functions[1].name).toBe('_private_func');
      expect(functions[1].isExported).toBe(false);
      expect(functions[2].name).toBe('__dunder_func__');
      expect(functions[2].isExported).toBe(false);
    });

    it('should not export nested_local from a public top-level function', () => {
      const code = `
def public_py():
    def nested_local():
        return "nested"
    return nested_local()
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions.find((fn) => fn.name === 'public_py')?.isExported).toBe(true);
      expect(functions.find((fn) => fn.name === 'nested_local')?.isExported).toBe(false);
    });

    it('should not extract methods inside classes (class methods are owned by extractClassesWithEdges)', () => {
      const code = `
class Dog:
    def __init__(self, name: str):
        self.name = name

    def bark(self) -> str:
        return "Woof"
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      // extractFunctions skips class-body methods — they are extracted by
      // extractClassesWithEdges with generateEntityId-format ids that match this
      // extractor's id format, avoiding HAS_METHOD edge toId mismatches.
      expect(functions.length).toBe(0);
    });

    it('should filter out self and cls parameters (class methods via extractAllEntities)', () => {
      const code = `
class MyClass:
    def instance_method(self, x: int):
        pass

    @classmethod
    def class_method(cls, y: str):
        pass
      `;
      const rootNode = parseCode(code);
      // Class methods are extracted via extractAllEntities (which calls extractClassesWithEdges)
      const result = extractAllEntities(rootNode as any, TEST_FILE);

      const instanceMethod = result.functions.find((f: any) => f.name === 'instance_method');
      expect(instanceMethod).toBeDefined();
      expect(instanceMethod!.params).toEqual([{ name: 'x', type: 'int' }]);

      const classMethod = result.functions.find((f: any) => f.name === 'class_method');
      expect(classMethod).toBeDefined();
      expect(classMethod!.params).toEqual([{ name: 'y', type: 'str' }]);
    });
  });

  // ==========================================================================
  // Class Extraction
  // ==========================================================================

  describe('extractClasses', () => {
    it('should extract basic class definitions', () => {
      const code = `
class Animal:
    pass
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('Animal');
      expect(classes[0].filePath).toBe(TEST_FILE);
      expect(classes[0].isExported).toBe(true);
    });

    it('should extract class with inheritance', () => {
      const code = `
class Dog(Animal):
    pass
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('Dog');
      expect(classes[0].extends).toBe('Animal');
    });

    it('should extract class docstrings', () => {
      const code = `
class Animal:
    """Base animal class."""
    pass
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].docstring).toBe('Base animal class.');
    });

    it('should mark private classes as not exported', () => {
      const code = `
class PublicClass:
    pass

class _PrivateClass:
    pass
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(2);
      expect(classes[0].isExported).toBe(true);
      expect(classes[1].isExported).toBe(false);
    });

    it('should extract multiple classes with inheritance chains', () => {
      const code = `
class Base:
    pass

class Middle(Base):
    pass

class Derived(Middle):
    pass
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(3);
      expect(classes[0].extends).toBeUndefined();
      expect(classes[1].extends).toBe('Base');
      expect(classes[2].extends).toBe('Middle');
    });
  });

  // ==========================================================================
  // Import Extraction
  // ==========================================================================

  describe('extractImports', () => {
    it('should extract simple import statements', () => {
      const code = `
import os
import sys
      `;
      const rootNode = parseCode(code);
      const imports = extractImports(rootNode as any, TEST_FILE);

      expect(imports).toHaveLength(2);
      expect(imports[0].source).toBe('os');
      expect(imports[0].isNamespace).toBe(true);
      expect(imports[1].source).toBe('sys');
    });

    it('should extract from-import statements', () => {
      const code = `
from pathlib import Path
from typing import List, Optional
      `;
      const rootNode = parseCode(code);
      const imports = extractImports(rootNode as any, TEST_FILE);

      expect(imports).toHaveLength(2);
      expect(imports[0].source).toBe('pathlib');
      expect(imports[0].specifiers).toHaveLength(1);
      expect(imports[0].specifiers[0].name).toBe('Path');

      expect(imports[1].source).toBe('typing');
      expect(imports[1].specifiers.length).toBeGreaterThanOrEqual(2);
    });

    it('should extract aliased imports', () => {
      const code = `
import json as j
      `;
      const rootNode = parseCode(code);
      const imports = extractImports(rootNode as any, TEST_FILE);

      expect(imports).toHaveLength(1);
      // The module name should be 'json' (the aliased_import's name field)
      expect(imports[0].source).toBeDefined();
    });

    it('should extract from-import with aliases', () => {
      const code = `
from collections import OrderedDict as OD
      `;
      const rootNode = parseCode(code);
      const imports = extractImports(rootNode as any, TEST_FILE);

      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('collections');
      expect(imports[0].specifiers).toHaveLength(1);
      expect(imports[0].specifiers[0].name).toBe('OrderedDict');
      expect(imports[0].specifiers[0].alias).toBe('OD');
    });
  });

  // ==========================================================================
  // Variable Extraction
  // ==========================================================================

  describe('extractVariables', () => {
    it('should extract top-level variable assignments', () => {
      const code = `
debug_mode = True
max_retries = 5
      `;
      const rootNode = parseCode(code);
      const variables = extractVariables(rootNode as any, TEST_FILE);

      expect(variables).toHaveLength(2);
      expect(variables[0].name).toBe('debug_mode');
      expect(variables[0].kind).toBe('let');
      expect(variables[1].name).toBe('max_retries');
    });

    it('should detect UPPER_CASE constants', () => {
      const code = `
MAX_RETRIES = 5
BASE_URL = "https://example.com"
      `;
      const rootNode = parseCode(code);
      const variables = extractVariables(rootNode as any, TEST_FILE);

      expect(variables).toHaveLength(2);
      expect(variables[0].name).toBe('MAX_RETRIES');
      expect(variables[0].kind).toBe('const');
      expect(variables[1].name).toBe('BASE_URL');
      expect(variables[1].kind).toBe('const');
    });

    it('should mark private variables as not exported', () => {
      const code = `
public_var = 42
_private_var = "secret"
      `;
      const rootNode = parseCode(code);
      const variables = extractVariables(rootNode as any, TEST_FILE);

      expect(variables).toHaveLength(2);
      expect(variables[0].isExported).toBe(true);
      expect(variables[1].isExported).toBe(false);
    });
  });

  // ==========================================================================
  // Inheritance Extraction
  // ==========================================================================

  describe('extractInheritance', () => {
    it('should extract single inheritance', () => {
      const code = `
class Animal:
    pass

class Dog(Animal):
    pass
      `;
      const rootNode = parseCode(code);
      const inheritance = extractInheritance(rootNode as any, TEST_FILE);

      expect(inheritance).toHaveLength(1);
      expect(inheritance[0].childName).toBe('Dog');
      expect(inheritance[0].parentName).toBe('Animal');
      expect(inheritance[0].type).toBe('extends');
    });

    it('should extract inheritance chains', () => {
      const code = `
class Base:
    pass

class Middle(Base):
    pass

class Derived(Middle):
    pass
      `;
      const rootNode = parseCode(code);
      const inheritance = extractInheritance(rootNode as any, TEST_FILE);

      expect(inheritance).toHaveLength(2);
      const middleRef = inheritance.find(r => r.childName === 'Middle');
      const derivedRef = inheritance.find(r => r.childName === 'Derived');
      expect(middleRef?.parentName).toBe('Base');
      expect(derivedRef?.parentName).toBe('Middle');
    });

    it('should not generate refs for classes without parents', () => {
      const code = `
class StandaloneClass:
    pass
      `;
      const rootNode = parseCode(code);
      const inheritance = extractInheritance(rootNode as any, TEST_FILE);

      expect(inheritance).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Call Extraction
  // ==========================================================================

  describe('extractCalls', () => {
    it('should extract local function calls', () => {
      const code = `
def helper():
    return 42

def main():
    result = helper()
    return result
      `;
      const rootNode = parseCode(code);
      const calls = extractCalls(rootNode as any, TEST_FILE);

      expect(calls).toHaveLength(1);
      expect(calls[0].callerName).toBe('main');
      expect(calls[0].calleeName).toBe('helper');
    });

    it('should skip built-in function calls', () => {
      const code = `
def process():
    data = [1, 2, 3]
    n = len(data)
    print(n)
    result = sorted(data)
    return result
      `;
      const rootNode = parseCode(code);
      const calls = extractCalls(rootNode as any, TEST_FILE);

      // len, print, sorted are all builtins — should be skipped
      expect(calls).toHaveLength(0);
    });

    it('should not extract calls to external functions', () => {
      const code = `
def process():
    result = external_function()
    return result
      `;
      const rootNode = parseCode(code);
      const calls = extractCalls(rootNode as any, TEST_FILE);

      // external_function is not defined locally
      expect(calls).toHaveLength(0);
    });

    it('should extract multiple call relationships', () => {
      const code = `
def validate(data):
    return data is not None

def transform(data):
    return data.upper()

def process(data):
    if validate(data):
        return transform(data)
    return None
      `;
      const rootNode = parseCode(code);
      const calls = extractCalls(rootNode as any, TEST_FILE);

      expect(calls).toHaveLength(2);
      expect(calls.every(c => c.callerName === 'process')).toBe(true);
      const calleeNames = calls.map(c => c.calleeName);
      expect(calleeNames).toContain('validate');
      expect(calleeNames).toContain('transform');
    });
  });

  // ==========================================================================
  // extractAllEntities
  // ==========================================================================

  describe('extractAllEntities', () => {
    it('should extract all entity types from a complete Python file', () => {
      const code = `
import os
from pathlib import Path

MAX_RETRIES = 5
debug_mode = True

class Animal:
    """Base animal class."""
    def __init__(self, name: str):
        self.name = name

class Dog(Animal):
    def bark(self) -> str:
        return "Woof"

def greet(name: str) -> str:
    """Say hello."""
    return f"Hello {name}"

async def fetch_data(url: str, timeout: int = 30) -> dict:
    pass
      `;
      const rootNode = parseCode(code);
      const entities = extractAllEntities(rootNode as any, TEST_FILE);

      expect(entities.functions.length).toBeGreaterThanOrEqual(4); // greet, fetch_data, __init__, bark
      expect(entities.classes).toHaveLength(2);
      expect(entities.imports).toHaveLength(2);
      expect(entities.variables).toHaveLength(2);
    });
  });

  // ==========================================================================
  // HAS_METHOD / HAS_PROPERTY edges
  // ==========================================================================

  describe('Python HAS_METHOD / HAS_PROPERTY', () => {
    it('emits Function entities + HAS_METHOD edges for class methods', () => {
      const code = `
class User:
    name: str = ""
    age: int = 0
    def greet(self) -> str:
        return f"hi {self.name}"
    @staticmethod
    def static_method() -> None:
        pass
    def _private_method(self):
        pass
`;
      const rootNode = parseCode(code);
      const result = extractAllEntities(rootNode as any, TEST_FILE);

      const userClass = result.classes.find(c => c.name === 'User');
      expect(userClass).toBeDefined();

      const hasMethodEdges = result.hasMethodEdges ?? [];
      const userMethodEdges = hasMethodEdges.filter(e => e.fromId === userClass!.id);
      expect(userMethodEdges).toHaveLength(3);

      // Method entities are found via HAS_METHOD edge toIds (generateEntityId format)
      const methods = userMethodEdges.map(e => result.functions.find(f => f.id === e.toId)!);
      expect(methods.map(m => m.name).sort()).toEqual(['_private_method', 'greet', 'static_method']);

      const staticEdge = userMethodEdges.find(
        e => result.functions.find(f => f.id === e.toId)?.name === 'static_method'
      );
      expect(staticEdge?.isStatic).toBe(true);

      const greetEdge = userMethodEdges.find(
        e => result.functions.find(f => f.id === e.toId)?.name === 'greet'
      );
      expect(greetEdge?.isStatic).toBe(false);
      expect(greetEdge?.visibility).toBe('public');

      const privateEdge = userMethodEdges.find(
        e => result.functions.find(f => f.id === e.toId)?.name === '_private_method'
      );
      expect(privateEdge?.visibility).toBe('private');
    });

    it('emits Variable entities + HAS_PROPERTY edges for class fields', () => {
      const code = `
class User:
    name: str = ""
    _hidden: int = 0
`;
      const rootNode = parseCode(code);
      const result = extractAllEntities(rootNode as any, TEST_FILE);

      const userClass = result.classes.find(c => c.name === 'User');
      expect(userClass).toBeDefined();

      const props = result.variables.filter(
        v => typeof v.id === 'string' && v.id.startsWith(`${userClass!.id}::prop`)
      );
      expect(props.map(p => p.name).sort()).toEqual(['_hidden', 'name']);

      const hasPropEdges = (result.hasPropertyEdges ?? []).filter(e => e.fromId === userClass!.id);
      expect(hasPropEdges).toHaveLength(2);

      const nameProp = props.find(p => p.name === 'name')!;
      const nameEdge = hasPropEdges.find(e => e.toId === nameProp.id);
      expect(nameEdge?.isStatic).toBe(true);
      expect(nameEdge?.visibility).toBe('public');
      expect(nameEdge?.isReadonly).toBe(false);

      const hiddenProp = props.find(p => p.name === '_hidden')!;
      const hiddenEdge = hasPropEdges.find(e => e.toId === hiddenProp.id);
      expect(hiddenEdge?.visibility).toBe('private');
    });

    it('treats dunder methods as public visibility', () => {
      const code = `
class Foo:
    def __init__(self):
        pass
    def __str__(self) -> str:
        return "foo"
`;
      const rootNode = parseCode(code);
      const result = extractAllEntities(rootNode as any, TEST_FILE);

      const fooClass = result.classes.find(c => c.name === 'Foo')!;
      const hasMethodEdges = (result.hasMethodEdges ?? []).filter(e => e.fromId === fooClass.id);
      expect(hasMethodEdges).toHaveLength(2);
      for (const edge of hasMethodEdges) {
        expect(edge.visibility).toBe('public');
      }
    });

    it('marks @classmethod as isStatic', () => {
      const code = `
class MyClass:
    @classmethod
    def from_string(cls, s: str):
        pass
`;
      const rootNode = parseCode(code);
      const result = extractAllEntities(rootNode as any, TEST_FILE);

      const cls = result.classes.find(c => c.name === 'MyClass')!;
      const hasMethodEdges = (result.hasMethodEdges ?? []).filter(e => e.fromId === cls.id);
      expect(hasMethodEdges).toHaveLength(1);
      expect(hasMethodEdges[0].isStatic).toBe(true);
    });
  });

  // ==========================================================================
  // HAS_PARAM / RETURNS / USES_TYPE edges
  // ==========================================================================

  describe('Python: HAS_PARAM / RETURNS / USES_TYPE', () => {
    it('emits HAS_PARAM and RETURNS for typed function', async () => {
      const code = `
def greet(name: str, count: int = 1) -> str:
    msg: str = f"hi {name}"
    return msg * count
`;
      const rootNode = parseCode(code);
      const result = extractAllEntities(rootNode as any, TEST_FILE);
      const fn = result.functions.find((e: any) => e.name === 'greet')!;
      expect(fn).toBeDefined();

      const hasParam = (result.hasParamEdges ?? []).filter((e: any) => e.fromId === fn.id);
      expect(hasParam).toHaveLength(2);
      const params = hasParam.map((e: any) => {
        const t = (result.typeRefs ?? []).find((tr: any) => tr.id === e.toId)!;
        return { name: e.name, typeName: t.name };
      }).sort((a: any, b: any) => a.name.localeCompare(b.name));
      expect(params).toEqual([
        { name: 'count', typeName: 'int' },
        { name: 'name', typeName: 'str' },
      ]);

      const returns = (result.returnsEdges ?? []).filter((e: any) => e.fromId === fn.id);
      expect(returns).toHaveLength(1);
      const ret = returns[0]! as { toId?: string };
      const returnRef = (result.typeRefs ?? []).find((t: any) => t.id === ret.toId)!;
      expect(returnRef.name).toBe('str');

      const usesType = (result.usesTypeEdges ?? []).filter((e: any) => e.fromId === fn.id);
      expect(usesType.length).toBeGreaterThanOrEqual(1);
    });

    it('emits no type edges for an untyped function', () => {
      const code = `
def add(a, b):
    return a + b
`;
      const rootNode = parseCode(code);
      const result = extractAllEntities(rootNode as any, TEST_FILE);
      const fn = result.functions.find((e: any) => e.name === 'add')!;
      expect(fn).toBeDefined();

      const paramEdges = (result.hasParamEdges ?? []).filter((e: any) => e.fromId === fn.id);
      expect(paramEdges).toHaveLength(0);
      const returns = (result.returnsEdges ?? []).filter((e: any) => e.fromId === fn.id);
      expect(returns).toHaveLength(0);
    });

    it('marks isAsync correctly for async functions', () => {
      const code = `
async def fetch_data(url: str) -> dict:
    pass
`;
      const rootNode = parseCode(code);
      const result = extractAllEntities(rootNode as any, TEST_FILE);
      const fn = result.functions.find((e: any) => e.name === 'fetch_data')!;
      expect(fn).toBeDefined();

      const returns = (result.returnsEdges ?? []).filter((e: any) => e.fromId === fn.id);
      expect(returns).toHaveLength(1);
      const ret = returns[0]! as { isAsync?: boolean };
      expect(ret.isAsync).toBe(true);
    });

    it('marks isOptional for typed_default_parameter params', () => {
      const code = `
def f(x: int = 1, y: str = "hi"):
    pass
`;
      const rootNode = parseCode(code);
      const result = extractAllEntities(rootNode as any, TEST_FILE);
      const fn = result.functions.find((e: any) => e.name === 'f')!;
      expect(fn).toBeDefined();

      const params = (result.hasParamEdges ?? []).filter((e: any) => e.fromId === fn.id);
      expect(params).toHaveLength(2);
      expect(params.every((p: any) => p.isOptional === true)).toBe(true);
    });

    it('emits HAS_PARAM and RETURNS for typed class methods', () => {
      const code = `
class Greeter:
    def greet(self, name: str) -> str:
        return f"hi {name}"
`;
      const rootNode = parseCode(code);
      const result = extractAllEntities(rootNode as any, TEST_FILE);

      const cls = result.classes.find((c: any) => c.name === 'Greeter')!;
      expect(cls).toBeDefined();

      // Find the greet method entity via HAS_METHOD edges (generateEntityId format now)
      const greetEdge = (result.hasMethodEdges ?? []).find(
        (e: any) => result.functions.find((f: any) => f.id === e.toId)?.name === 'greet' && e.fromId === cls.id
      );
      const greetMethod = result.functions.find((f: any) => f.id === greetEdge?.toId)!;
      expect(greetMethod).toBeDefined();

      const params = (result.hasParamEdges ?? []).filter((e: any) => e.fromId === greetMethod.id);
      // 'self' is filtered — only 'name: str' should appear
      expect(params).toHaveLength(1);
      const nameParam = params[0]!;
      const typeRef = (result.typeRefs ?? []).find((t: any) => t.id === nameParam.toId)!;
      expect(typeRef.name).toBe('str');

      const returns = (result.returnsEdges ?? []).filter((e: any) => e.fromId === greetMethod.id);
      expect(returns).toHaveLength(1);
      const retRef = (result.typeRefs ?? []).find((t: any) => t.id === (returns[0]! as any).toId)!;
      expect(retRef.name).toBe('str');
    });

    it('marks str and int as primitives', () => {
      const code = `
def add(a: int, b: int) -> int:
    pass
`;
      const rootNode = parseCode(code);
      const result = extractAllEntities(rootNode as any, TEST_FILE);
      const fn = result.functions.find((e: any) => e.name === 'add')!;
      const params = (result.hasParamEdges ?? []).filter((e: any) => e.fromId === fn.id);
      for (const p of params) {
        const ref = (result.typeRefs ?? []).find((t: any) => t.id === p.toId)!;
        expect(ref.isPrimitive).toBe(true);
        expect(ref.id).toBe(`prim::python::int`);
      }
    });
  });
});
