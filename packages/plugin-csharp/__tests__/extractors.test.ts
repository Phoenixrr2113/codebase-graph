/**
 * C# Plugin Unit Tests
 * Tests for entity extraction from C# syntax trees
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Parser from 'tree-sitter';
import CSharp from 'tree-sitter-c-sharp';
import {
  extractClasses,
  extractInterfaces,
  extractFunctions,
  extractVariables,
  extractImports,
  extractTypes,
  extractInheritance,
  extractCalls,
  extractAllEntities,
} from '../src';

const TEST_FILE = '/test/Sample.cs';

let parser: Parser;

function parseCode(code: string): Parser.SyntaxNode {
  const tree = parser.parse(code);
  return tree.rootNode;
}

describe('C# Extractors', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(CSharp as any);
  });

  afterAll(() => {
    // Parser cleanup if needed
  });

  describe('extractClasses', () => {
    it('should extract public class declarations', () => {
      const code = `
        public class MyClass
        {
            public string Name { get; set; }
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('MyClass');
      expect(classes[0].isExported).toBe(true);
      expect(classes[0].isAbstract).toBe(false);
    });

    it('should extract abstract classes', () => {
      const code = `
        public abstract class BaseService
        {
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('BaseService');
      expect(classes[0].isAbstract).toBe(true);
    });

    it('should extract class with inheritance', () => {
      const code = `
        public class Dog : Animal
        {
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('Dog');
      expect(classes[0].extends).toBe('Animal');
    });

    it('should extract class with interface implementation', () => {
      const code = `
        public class UserService : IUserService
        {
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('UserService');
      expect(classes[0].implements).toContain('IUserService');
    });

    it('should extract structs', () => {
      const code = `
        public struct Point
        {
            public int X;
            public int Y;
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('Point');
    });

    it('should extract records', () => {
      const code = `
        public record Person(string Name, int Age);
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('Person');
    });
  });

  describe('extractInterfaces', () => {
    it('should extract interface declarations', () => {
      const code = `
        public interface IRepository
        {
            void Save();
        }
      `;
      const rootNode = parseCode(code);
      const interfaces = extractInterfaces(rootNode as any, TEST_FILE);

      expect(interfaces).toHaveLength(1);
      expect(interfaces[0].name).toBe('IRepository');
      expect(interfaces[0].isExported).toBe(true);
    });

    it('should extract interface with extends', () => {
      const code = `
        public interface IUserRepository : IRepository
        {
        }
      `;
      const rootNode = parseCode(code);
      const interfaces = extractInterfaces(rootNode as any, TEST_FILE);

      expect(interfaces).toHaveLength(1);
      expect(interfaces[0].name).toBe('IUserRepository');
      expect(interfaces[0].extends).toContain('IRepository');
    });
  });

  describe('extractFunctions', () => {
    it('should extract method declarations', () => {
      const code = `
        public class Service
        {
            public string GetData(int id)
            {
                return "data";
            }
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('GetData');
      expect(functions[0].isAsync).toBe(false);
      expect(functions[0].returnType).toBe('string');
      expect(functions[0].params).toHaveLength(1);
      expect(functions[0].params[0].name).toBe('id');
      expect(functions[0].params[0].type).toBe('int');
    });

    it('should extract async methods', () => {
      const code = `
        public class Service
        {
            public async Task<string> GetDataAsync()
            {
                return await Task.FromResult("data");
            }
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('GetDataAsync');
      expect(functions[0].isAsync).toBe(true);
    });

    it('should extract constructors', () => {
      const code = `
        public class Service
        {
            public Service(ILogger logger)
            {
            }
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('Service');
      expect(functions[0].params).toHaveLength(1);
      expect(functions[0].params[0].name).toBe('logger');
    });

    it('should extract methods with optional parameters', () => {
      const code = `
        public class Service
        {
            public void Configure(string name = "default")
            {
            }
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].params[0].optional).toBe(true);
    });
  });

  describe('extractVariables', () => {
    it('should extract field declarations', () => {
      const code = `
        public class Config
        {
            private readonly string _apiKey;
            public int MaxRetries = 3;
        }
      `;
      const rootNode = parseCode(code);
      const variables = extractVariables(rootNode as any, TEST_FILE);

      expect(variables.length).toBeGreaterThanOrEqual(2);
      const apiKey = variables.find(v => v.name === '_apiKey');
      const maxRetries = variables.find(v => v.name === 'MaxRetries');

      expect(apiKey).toBeDefined();
      expect(apiKey?.kind).toBe('const'); // readonly
      
      expect(maxRetries).toBeDefined();
      expect(maxRetries?.isExported).toBe(true);
    });

    it('should extract property declarations', () => {
      const code = `
        public class User
        {
            public string Name { get; set; }
            public int Age { get; private set; }
        }
      `;
      const rootNode = parseCode(code);
      const variables = extractVariables(rootNode as any, TEST_FILE);

      expect(variables.length).toBeGreaterThanOrEqual(2);
      expect(variables.some(v => v.name === 'Name')).toBe(true);
      expect(variables.some(v => v.name === 'Age')).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should extract using directives', () => {
      const code = `
        using System;
        using System.Collections.Generic;
      `;
      const rootNode = parseCode(code);
      const imports = extractImports(rootNode as any, TEST_FILE);

      expect(imports).toHaveLength(2);
      expect(imports[0].source).toBe('System');
      expect(imports[1].source).toBe('System.Collections.Generic');
    });

    it('should extract aliased using directives', () => {
      const code = `
        using MyList = System.Collections.Generic.List<int>;
      `;
      const rootNode = parseCode(code);
      const imports = extractImports(rootNode as any, TEST_FILE);

      expect(imports).toHaveLength(1);
      expect(imports[0].namespaceAlias).toBe('MyList');
    });
  });

  describe('extractTypes', () => {
    it('should extract enum declarations', () => {
      const code = `
        public enum Status
        {
            Active,
            Inactive,
            Pending
        }
      `;
      const rootNode = parseCode(code);
      const types = extractTypes(rootNode as any, TEST_FILE);

      expect(types).toHaveLength(1);
      expect(types[0].name).toBe('Status');
      expect(types[0].kind).toBe('enum');
    });

    it('should extract delegate declarations', () => {
      const code = `
        public delegate void EventHandler(object sender, EventArgs args);
      `;
      const rootNode = parseCode(code);
      const types = extractTypes(rootNode as any, TEST_FILE);

      expect(types).toHaveLength(1);
      expect(types[0].name).toBe('EventHandler');
      expect(types[0].kind).toBe('type');
    });
  });

  describe('extractInheritance', () => {
    it('should extract extends relationships', () => {
      const code = `
        public class Animal { }
        public class Dog : Animal { }
      `;
      const rootNode = parseCode(code);
      const inheritance = extractInheritance(rootNode as any, TEST_FILE);

      const extendsRefs = inheritance.filter(r => r.type === 'extends');
      expect(extendsRefs).toHaveLength(1);
      expect(extendsRefs[0].childName).toBe('Dog');
      expect(extendsRefs[0].parentName).toBe('Animal');
    });

    it('should extract implements relationships', () => {
      const code = `
        public interface IService { }
        public class MyService : IService { }
      `;
      const rootNode = parseCode(code);
      const inheritance = extractInheritance(rootNode as any, TEST_FILE);

      const implRefs = inheritance.filter(r => r.type === 'implements');
      expect(implRefs).toHaveLength(1);
      expect(implRefs[0].childName).toBe('MyService');
      expect(implRefs[0].parentName).toBe('IService');
    });
  });

  describe('extractAllEntities', () => {
    it('should extract all entity types at once', () => {
      const code = `
        using System;
        
        public interface IService
        {
            void Execute();
        }
        
        public enum Status { Active, Inactive }
        
        public class MyService : IService
        {
            private readonly string _name;
            
            public MyService(string name)
            {
                _name = name;
            }
            
            public void Execute()
            {
                Console.WriteLine(_name);
            }
        }
      `;
      const rootNode = parseCode(code);
      const entities = extractAllEntities(rootNode as any, TEST_FILE);

      expect(entities.imports).toHaveLength(1);
      expect(entities.interfaces).toHaveLength(1);
      expect(entities.classes).toHaveLength(1);
      expect(entities.types).toHaveLength(1);
      expect(entities.functions.length).toBeGreaterThan(0);
      expect(entities.variables.length).toBeGreaterThan(0);
      expect(entities.components).toHaveLength(0); // C# doesn't have React components
    });
  });
});
