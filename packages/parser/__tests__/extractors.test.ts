/**
 * Extractor Unit Tests
 * Tests for entity extraction from parsed syntax trees
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initParser,
  parseCode,
  disposeParser,
  extractImports,
  extractFunctions,
  extractClasses,
  extractVariables,
  extractTypes,
  extractInterfaces,
  extractComponents,
  extractAllEntities,
} from '../src/index.js';

const TEST_FILE = '/test/sample.ts';

describe('Extractors', () => {
  beforeAll(async () => {
    await initParser();
  });

  afterAll(() => {
    disposeParser();
  });

  describe('extractImports', () => {
    it('should extract default imports', () => {
      const code = `import React from 'react';`;
      const { rootNode } = parseCode(code, 'typescript');
      const imports = extractImports(rootNode, TEST_FILE);
      
      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('react');
      expect(imports[0].isDefault).toBe(true);
      expect(imports[0].defaultAlias).toBe('React');
    });

    it('should extract named imports', () => {
      const code = `import { useState, useEffect } from 'react';`;
      const { rootNode } = parseCode(code, 'typescript');
      const imports = extractImports(rootNode, TEST_FILE);
      
      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('react');
      expect(imports[0].isDefault).toBe(false);
      expect(imports[0].specifiers).toHaveLength(2);
      expect(imports[0].specifiers[0].name).toBe('useState');
      expect(imports[0].specifiers[1].name).toBe('useEffect');
    });

    it('should extract namespace imports', () => {
      const code = `import * as fs from 'node:fs';`;
      const { rootNode } = parseCode(code, 'typescript');
      const imports = extractImports(rootNode, TEST_FILE);
      
      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('node:fs');
      expect(imports[0].isNamespace).toBe(true);
      expect(imports[0].namespaceAlias).toBe('fs');
    });

    it('should extract aliased imports', () => {
      const code = `import { Component as Comp } from 'react';`;
      const { rootNode } = parseCode(code, 'typescript');
      const imports = extractImports(rootNode, TEST_FILE);
      
      expect(imports).toHaveLength(1);
      expect(imports[0].specifiers[0].name).toBe('Component');
      expect(imports[0].specifiers[0].alias).toBe('Comp');
    });
  });

  describe('extractFunctions', () => {
    it('should extract function declarations', () => {
      const code = `function greet(name: string): string {
        return 'Hello ' + name;
      }`;
      const { rootNode } = parseCode(code, 'typescript');
      const functions = extractFunctions(rootNode, TEST_FILE);
      
      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('greet');
      expect(functions[0].isAsync).toBe(false);
      expect(functions[0].isArrow).toBe(false);
      expect(functions[0].params).toHaveLength(1);
      expect(functions[0].params[0].name).toBe('name');
    });

    it('should extract arrow functions', () => {
      const code = `const add = (a: number, b: number) => a + b;`;
      const { rootNode } = parseCode(code, 'typescript');
      const functions = extractFunctions(rootNode, TEST_FILE);
      
      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('add');
      expect(functions[0].isArrow).toBe(true);
      expect(functions[0].params).toHaveLength(2);
    });

    it('should extract async functions', () => {
      const code = `async function fetchData(): Promise<void> {}`;
      const { rootNode } = parseCode(code, 'typescript');
      const functions = extractFunctions(rootNode, TEST_FILE);
      
      expect(functions).toHaveLength(1);
      expect(functions[0].isAsync).toBe(true);
    });

    it('should detect exported functions', () => {
      const code = `export function publicFunc() {}`;
      const { rootNode } = parseCode(code, 'typescript');
      const functions = extractFunctions(rootNode, TEST_FILE);
      
      expect(functions).toHaveLength(1);
      expect(functions[0].isExported).toBe(true);
    });
  });

  describe('extractClasses', () => {
    it('should extract class declarations', () => {
      const code = `class Animal {
        name: string;
        constructor(name: string) {
          this.name = name;
        }
      }`;
      const { rootNode } = parseCode(code, 'typescript');
      const classes = extractClasses(rootNode, TEST_FILE);
      
      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('Animal');
      expect(classes[0].isExported).toBe(false);
      expect(classes[0].isAbstract).toBe(false);
    });

    it('should extract class with extends', () => {
      const code = `class Dog extends Animal {}`;
      const { rootNode } = parseCode(code, 'typescript');
      const classes = extractClasses(rootNode, TEST_FILE);
      
      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('Dog');
      expect(classes[0].extends).toBe('Animal');
    });

    it('should extract exported classes', () => {
      const code = `export class Service {}`;
      const { rootNode } = parseCode(code, 'typescript');
      const classes = extractClasses(rootNode, TEST_FILE);
      
      expect(classes).toHaveLength(1);
      expect(classes[0].isExported).toBe(true);
    });
  });

  describe('extractVariables', () => {
    it('should extract const declarations', () => {
      const code = `const API_URL = 'https://example.com';`;
      const { rootNode } = parseCode(code, 'typescript');
      const variables = extractVariables(rootNode, TEST_FILE);
      
      expect(variables).toHaveLength(1);
      expect(variables[0].name).toBe('API_URL');
      expect(variables[0].kind).toBe('const');
    });

    it('should extract let declarations', () => {
      const code = `let counter = 0;`;
      const { rootNode } = parseCode(code, 'typescript');
      const variables = extractVariables(rootNode, TEST_FILE);
      
      expect(variables).toHaveLength(1);
      expect(variables[0].name).toBe('counter');
      expect(variables[0].kind).toBe('let');
    });

    it('should extract exported variables', () => {
      const code = `export const VERSION = '1.0.0';`;
      const { rootNode } = parseCode(code, 'typescript');
      const variables = extractVariables(rootNode, TEST_FILE);
      
      expect(variables).toHaveLength(1);
      expect(variables[0].isExported).toBe(true);
    });
  });

  describe('extractTypes', () => {
    it('should extract type aliases', () => {
      const code = `type UserId = string;`;
      const { rootNode } = parseCode(code, 'typescript');
      const types = extractTypes(rootNode, TEST_FILE);
      
      expect(types).toHaveLength(1);
      expect(types[0].name).toBe('UserId');
      expect(types[0].kind).toBe('type');
    });

    it('should extract enums', () => {
      const code = `enum Color { Red, Green, Blue }`;
      const { rootNode } = parseCode(code, 'typescript');
      const types = extractTypes(rootNode, TEST_FILE);
      
      expect(types).toHaveLength(1);
      expect(types[0].name).toBe('Color');
      expect(types[0].kind).toBe('enum');
    });
  });

  describe('extractInterfaces', () => {
    it('should extract interfaces', () => {
      const code = `interface User {
        id: string;
        name: string;
      }`;
      const { rootNode } = parseCode(code, 'typescript');
      const interfaces = extractInterfaces(rootNode, TEST_FILE);
      
      expect(interfaces).toHaveLength(1);
      expect(interfaces[0].name).toBe('User');
    });

    it('should extract exported interfaces', () => {
      const code = `export interface Config { debug: boolean; }`;
      const { rootNode } = parseCode(code, 'typescript');
      const interfaces = extractInterfaces(rootNode, TEST_FILE);
      
      expect(interfaces).toHaveLength(1);
      expect(interfaces[0].isExported).toBe(true);
    });
  });

  describe('extractComponents', () => {
    it('should extract React function components', () => {
      const code = `function Button() {
        return <button>Click me</button>;
      }`;
      const { rootNode } = parseCode(code, 'tsx');
      const components = extractComponents(rootNode, TEST_FILE);
      
      expect(components).toHaveLength(1);
      expect(components[0].name).toBe('Button');
    });

    it('should extract React arrow function components', () => {
      const code = `const Card = () => <div className="card">Content</div>;`;
      const { rootNode } = parseCode(code, 'tsx');
      const components = extractComponents(rootNode, TEST_FILE);
      
      expect(components).toHaveLength(1);
      expect(components[0].name).toBe('Card');
    });

    it('should skip non-PascalCase functions', () => {
      const code = `const helperFunction = () => <span>helper</span>;`;
      const { rootNode } = parseCode(code, 'tsx');
      const components = extractComponents(rootNode, TEST_FILE);
      
      // Should not extract because name is not PascalCase
      expect(components).toHaveLength(0);
    });
  });

  describe('extractAllEntities', () => {
    it('should extract all entity types at once', () => {
      const code = `
        import { useState } from 'react';
        
        interface Props { label: string }
        
        type ButtonVariant = 'primary' | 'secondary';
        
        const VERSION = '1.0';
        
        function helper() {}
        
        export const Button = ({ label }: Props) => {
          const [count, setCount] = useState(0);
          return <button>{label}: {count}</button>;
        };
      `;
      const { rootNode } = parseCode(code, 'tsx');
      const entities = extractAllEntities(rootNode, TEST_FILE);
      
      expect(entities.imports).toHaveLength(1);
      expect(entities.interfaces).toHaveLength(1);
      expect(entities.types).toHaveLength(1);
      expect(entities.variables.length).toBeGreaterThan(0);
      expect(entities.functions.length).toBeGreaterThan(0);
      expect(entities.components).toHaveLength(1);
      expect(entities.components[0].name).toBe('Button');
    });
  });
});
