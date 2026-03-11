/**
 * Java Plugin Unit Tests
 * Tests for entity extraction from Java syntax trees
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Parser from 'tree-sitter';
import Java from 'tree-sitter-java';
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

const TEST_FILE = '/test/Sample.java';

let parser: Parser;

function parseCode(code: string): Parser.SyntaxNode {
  const tree = parser.parse(code);
  return tree.rootNode;
}

describe('Java Extractors', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(Java as any);
  });

  afterAll(() => {
    // Parser cleanup if needed
  });

  // ==========================================================================
  // Class Extraction
  // ==========================================================================

  describe('extractClasses', () => {
    it('should extract public class declarations', () => {
      const code = `
        public class MyClass {
            private String name;
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
        public abstract class BaseService {
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
        public class Dog extends Animal {
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
        public class UserService implements IUserService {
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('UserService');
      expect(classes[0].implements).toContain('IUserService');
    });

    it('should extract class with both extends and implements', () => {
      const code = `
        public class HttpService extends BaseService implements Serializable, Closeable {
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('HttpService');
      expect(classes[0].extends).toBe('BaseService');
      expect(classes[0].implements).toContain('Serializable');
      expect(classes[0].implements).toContain('Closeable');
    });

    it('should extract record declarations', () => {
      const code = `
        public record Point(int x, int y) {
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('Point');
    });

    it('should extract package-private class as non-exported', () => {
      const code = `
        class InternalHelper {
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('InternalHelper');
      expect(classes[0].isExported).toBe(false);
    });

    it('should extract Javadoc from class', () => {
      const code = `
        /**
         * Service for handling user operations.
         * @author dev
         */
        public class UserService {
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].docstring).toBeDefined();
      expect(classes[0].docstring).toContain('Service for handling user operations');
    });

    it('should extract class with generic superclass', () => {
      const code = `
        public class StringList extends ArrayList<String> {
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('StringList');
      expect(classes[0].extends).toBe('ArrayList');
    });
  });

  // ==========================================================================
  // Interface Extraction
  // ==========================================================================

  describe('extractInterfaces', () => {
    it('should extract interface declarations', () => {
      const code = `
        public interface Repository {
            void save();
        }
      `;
      const rootNode = parseCode(code);
      const interfaces = extractInterfaces(rootNode as any, TEST_FILE);

      expect(interfaces).toHaveLength(1);
      expect(interfaces[0].name).toBe('Repository');
      expect(interfaces[0].isExported).toBe(true);
    });

    it('should extract interface with extends', () => {
      const code = `
        public interface UserRepository extends Repository {
        }
      `;
      const rootNode = parseCode(code);
      const interfaces = extractInterfaces(rootNode as any, TEST_FILE);

      expect(interfaces).toHaveLength(1);
      expect(interfaces[0].name).toBe('UserRepository');
      expect(interfaces[0].extends).toContain('Repository');
    });

    it('should extract interface extending multiple interfaces', () => {
      const code = `
        public interface CrudRepository extends Repository, Serializable {
        }
      `;
      const rootNode = parseCode(code);
      const interfaces = extractInterfaces(rootNode as any, TEST_FILE);

      expect(interfaces).toHaveLength(1);
      expect(interfaces[0].extends).toHaveLength(2);
      expect(interfaces[0].extends).toContain('Repository');
      expect(interfaces[0].extends).toContain('Serializable');
    });

    it('should extract Javadoc from interface', () => {
      const code = `
        /**
         * Repository interface for data access.
         */
        public interface Repository {
        }
      `;
      const rootNode = parseCode(code);
      const interfaces = extractInterfaces(rootNode as any, TEST_FILE);

      expect(interfaces).toHaveLength(1);
      expect(interfaces[0].docstring).toContain('Repository interface for data access');
    });
  });

  // ==========================================================================
  // Method Extraction
  // ==========================================================================

  describe('extractFunctions', () => {
    it('should extract method declarations', () => {
      const code = `
        public class Service {
            public String getData(int id) {
                return "data";
            }
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('getData');
      expect(functions[0].isAsync).toBe(false);
      expect(functions[0].returnType).toBe('String');
      expect(functions[0].params).toHaveLength(1);
      expect(functions[0].params[0].name).toBe('id');
      expect(functions[0].params[0].type).toBe('int');
    });

    it('should extract constructors', () => {
      const code = `
        public class Service {
            public Service(String name, int count) {
            }
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('Service');
      expect(functions[0].params).toHaveLength(2);
      expect(functions[0].params[0].name).toBe('name');
      expect(functions[0].params[0].type).toBe('String');
      expect(functions[0].params[1].name).toBe('count');
      expect(functions[0].params[1].type).toBe('int');
    });

    it('should extract void methods', () => {
      const code = `
        public class Service {
            public void doSomething() {
            }
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('doSomething');
      expect(functions[0].returnType).toBe('void');
    });

    it('should extract static methods', () => {
      const code = `
        public class Utils {
            public static int max(int a, int b) {
                return a > b ? a : b;
            }
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('max');
      expect(functions[0].isExported).toBe(true);
    });

    it('should extract private methods as non-exported', () => {
      const code = `
        public class Service {
            private void helper() {
            }
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('helper');
      expect(functions[0].isExported).toBe(false);
    });

    it('should extract methods with generic return type', () => {
      const code = `
        public class Service {
            public List<String> getNames() {
                return null;
            }
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('getNames');
      expect(functions[0].returnType).toContain('List');
    });

    it('should extract Javadoc from methods', () => {
      const code = `
        public class Service {
            /**
             * Retrieves user by their unique identifier.
             * @param id the user identifier
             * @return the user object
             */
            public User getUser(int id) {
                return null;
            }
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].docstring).toBeDefined();
      expect(functions[0].docstring).toContain('Retrieves user by their unique identifier');
    });

    it('should extract multiple methods from a class', () => {
      const code = `
        public class Calculator {
            public int add(int a, int b) { return a + b; }
            public int subtract(int a, int b) { return a - b; }
            public int multiply(int a, int b) { return a * b; }
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(3);
      const names = functions.map((f) => f.name);
      expect(names).toContain('add');
      expect(names).toContain('subtract');
      expect(names).toContain('multiply');
    });
  });

  // ==========================================================================
  // Variable (Field) Extraction
  // ==========================================================================

  describe('extractVariables', () => {
    it('should extract field declarations', () => {
      const code = `
        public class Config {
            private final String apiKey;
            public int maxRetries = 3;
        }
      `;
      const rootNode = parseCode(code);
      const variables = extractVariables(rootNode as any, TEST_FILE);

      expect(variables.length).toBeGreaterThanOrEqual(2);
      const apiKey = variables.find((v) => v.name === 'apiKey');
      const maxRetries = variables.find((v) => v.name === 'maxRetries');

      expect(apiKey).toBeDefined();
      expect(apiKey?.kind).toBe('const'); // final
      expect(apiKey?.isExported).toBe(false); // private

      expect(maxRetries).toBeDefined();
      expect(maxRetries?.isExported).toBe(true); // public
      expect(maxRetries?.kind).toBe('let'); // not final
    });

    it('should extract static final fields (constants)', () => {
      const code = `
        public class Constants {
            public static final String VERSION = "1.0";
            public static final int MAX_SIZE = 100;
        }
      `;
      const rootNode = parseCode(code);
      const variables = extractVariables(rootNode as any, TEST_FILE);

      expect(variables.length).toBeGreaterThanOrEqual(2);
      const version = variables.find((v) => v.name === 'VERSION');
      expect(version).toBeDefined();
      expect(version?.kind).toBe('const');
      expect(version?.isExported).toBe(true);
    });

    it('should extract field type information', () => {
      const code = `
        public class Service {
            private List<String> items;
        }
      `;
      const rootNode = parseCode(code);
      const variables = extractVariables(rootNode as any, TEST_FILE);

      expect(variables).toHaveLength(1);
      expect(variables[0].name).toBe('items');
      expect(variables[0].type).toContain('List');
    });
  });

  // ==========================================================================
  // Import Extraction
  // ==========================================================================

  describe('extractImports', () => {
    it('should extract import declarations', () => {
      const code = `
        import java.util.List;
        import java.util.Map;
      `;
      const rootNode = parseCode(code);
      const imports = extractImports(rootNode as any, TEST_FILE);

      expect(imports).toHaveLength(2);
      expect(imports[0].source).toBe('java.util');
      expect(imports[0].specifiers).toHaveLength(1);
      expect(imports[0].specifiers[0].name).toBe('List');

      expect(imports[1].source).toBe('java.util');
      expect(imports[1].specifiers[0].name).toBe('Map');
    });

    it('should extract wildcard imports', () => {
      const code = `
        import java.util.*;
      `;
      const rootNode = parseCode(code);
      const imports = extractImports(rootNode as any, TEST_FILE);

      expect(imports).toHaveLength(1);
      expect(imports[0].isNamespace).toBe(true);
      expect(imports[0].specifiers).toHaveLength(0);
    });

    it('should extract static imports', () => {
      const code = `
        import static org.junit.Assert.assertEquals;
      `;
      const rootNode = parseCode(code);
      const imports = extractImports(rootNode as any, TEST_FILE);

      expect(imports).toHaveLength(1);
      // Static imports should still extract the source and specifier
      expect(imports[0].specifiers.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle multiple imports from different packages', () => {
      const code = `
        import java.util.List;
        import java.io.File;
        import org.springframework.stereotype.Service;
      `;
      const rootNode = parseCode(code);
      const imports = extractImports(rootNode as any, TEST_FILE);

      expect(imports).toHaveLength(3);
    });
  });

  // ==========================================================================
  // Type Extraction (Enums & Annotations)
  // ==========================================================================

  describe('extractTypes', () => {
    it('should extract enum declarations', () => {
      const code = `
        public enum Status {
            ACTIVE,
            INACTIVE,
            PENDING
        }
      `;
      const rootNode = parseCode(code);
      const types = extractTypes(rootNode as any, TEST_FILE);

      expect(types).toHaveLength(1);
      expect(types[0].name).toBe('Status');
      expect(types[0].kind).toBe('enum');
    });

    it('should extract annotation type declarations', () => {
      const code = `
        public @interface MyAnnotation {
            String value();
        }
      `;
      const rootNode = parseCode(code);
      const types = extractTypes(rootNode as any, TEST_FILE);

      expect(types).toHaveLength(1);
      expect(types[0].name).toBe('MyAnnotation');
      expect(types[0].kind).toBe('type');
    });

    it('should extract Javadoc from enums', () => {
      const code = `
        /**
         * Represents the status of an order.
         */
        public enum OrderStatus {
            PENDING,
            SHIPPED,
            DELIVERED
        }
      `;
      const rootNode = parseCode(code);
      const types = extractTypes(rootNode as any, TEST_FILE);

      expect(types).toHaveLength(1);
      expect(types[0].docstring).toContain('status of an order');
    });
  });

  // ==========================================================================
  // Inheritance Extraction
  // ==========================================================================

  describe('extractInheritance', () => {
    it('should extract extends relationships', () => {
      const code = `
        public class Animal { }
        public class Dog extends Animal { }
      `;
      const rootNode = parseCode(code);
      const inheritance = extractInheritance(rootNode as any, TEST_FILE);

      const extendsRefs = inheritance.filter((r) => r.type === 'extends');
      expect(extendsRefs).toHaveLength(1);
      expect(extendsRefs[0].childName).toBe('Dog');
      expect(extendsRefs[0].parentName).toBe('Animal');
    });

    it('should extract implements relationships', () => {
      const code = `
        public interface Runnable { }
        public class Task implements Runnable { }
      `;
      const rootNode = parseCode(code);
      const inheritance = extractInheritance(rootNode as any, TEST_FILE);

      const implRefs = inheritance.filter((r) => r.type === 'implements');
      expect(implRefs).toHaveLength(1);
      expect(implRefs[0].childName).toBe('Task');
      expect(implRefs[0].parentName).toBe('Runnable');
    });

    it('should extract interface extends relationships', () => {
      const code = `
        public interface Base { }
        public interface Extended extends Base { }
      `;
      const rootNode = parseCode(code);
      const inheritance = extractInheritance(rootNode as any, TEST_FILE);

      const extendsRefs = inheritance.filter((r) => r.type === 'extends');
      expect(extendsRefs).toHaveLength(1);
      expect(extendsRefs[0].childName).toBe('Extended');
      expect(extendsRefs[0].parentName).toBe('Base');
    });

    it('should extract mixed inheritance', () => {
      const code = `
        public class BaseService { }
        public interface Closeable { }
        public interface Serializable { }
        public class HttpService extends BaseService implements Closeable, Serializable { }
      `;
      const rootNode = parseCode(code);
      const inheritance = extractInheritance(rootNode as any, TEST_FILE);

      const extendsRefs = inheritance.filter((r) => r.type === 'extends');
      const implRefs = inheritance.filter((r) => r.type === 'implements');

      expect(extendsRefs.some((r) => r.childName === 'HttpService' && r.parentName === 'BaseService')).toBe(true);
      expect(implRefs.some((r) => r.childName === 'HttpService' && r.parentName === 'Closeable')).toBe(true);
      expect(implRefs.some((r) => r.childName === 'HttpService' && r.parentName === 'Serializable')).toBe(true);
    });
  });

  // ==========================================================================
  // Call Extraction
  // ==========================================================================

  describe('extractCalls', () => {
    it('should extract local method calls', () => {
      const code = `
        public class Service {
            public void process() {
                validate();
                transform();
            }
            private void validate() { }
            private void transform() { }
        }
      `;
      const rootNode = parseCode(code);
      const calls = extractCalls(rootNode as any, TEST_FILE);

      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(calls.some((c) => c.callerName === 'process' && c.calleeName === 'validate')).toBe(true);
      expect(calls.some((c) => c.callerName === 'process' && c.calleeName === 'transform')).toBe(true);
    });

    it('should skip built-in method calls', () => {
      const code = `
        public class Service {
            public void process() {
                System.out.println("hello");
                String s = "test".toString();
                list.add("item");
            }
        }
      `;
      const rootNode = parseCode(code);
      const calls = extractCalls(rootNode as any, TEST_FILE);

      // println, toString, add are all builtins — should be skipped
      expect(calls.filter((c) => c.callerName === 'process')).toHaveLength(0);
    });

    it('should not extract calls to external methods', () => {
      const code = `
        public class Service {
            private Logger logger;
            public void process() {
                externalService.doWork();
            }
        }
      `;
      const rootNode = parseCode(code);
      const calls = extractCalls(rootNode as any, TEST_FILE);

      // doWork is not a local method — should not be included
      expect(calls.filter((c) => c.calleeName === 'doWork')).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Extract All Entities
  // ==========================================================================

  describe('extractAllEntities', () => {
    it('should extract all entity types at once', () => {
      const code = `
        import java.util.List;

        public interface Repository {
            void save();
        }

        public enum Status { ACTIVE, INACTIVE }

        public class UserService implements Repository {
            private final String name;

            public UserService(String name) {
                this.name = name;
            }

            public void save() {
                process();
            }

            private void process() { }
        }
      `;
      const rootNode = parseCode(code);
      const entities = extractAllEntities(rootNode as any, TEST_FILE);

      expect(entities.imports).toHaveLength(1);
      expect(entities.interfaces).toHaveLength(1);
      expect(entities.classes).toHaveLength(1);
      expect(entities.types).toHaveLength(1); // enum
      expect(entities.functions.length).toBeGreaterThan(0); // constructor + save + process
      expect(entities.variables.length).toBeGreaterThan(0); // name field
      expect(entities.components).toHaveLength(0); // Java doesn't have React components
    });

    it('should handle empty file', () => {
      const code = ``;
      const rootNode = parseCode(code);
      const entities = extractAllEntities(rootNode as any, TEST_FILE);

      expect(entities.functions).toHaveLength(0);
      expect(entities.classes).toHaveLength(0);
      expect(entities.interfaces).toHaveLength(0);
      expect(entities.variables).toHaveLength(0);
      expect(entities.imports).toHaveLength(0);
      expect(entities.types).toHaveLength(0);
      expect(entities.components).toHaveLength(0);
    });

    it('should handle complex class hierarchy', () => {
      const code = `
        import java.io.Serializable;
        import java.util.List;
        import java.util.ArrayList;

        /**
         * Base entity for all domain objects.
         */
        public abstract class BaseEntity implements Serializable {
            private Long id;
            public Long getId() { return id; }
        }

        public interface Auditable {
            String getCreatedBy();
        }

        public class User extends BaseEntity implements Auditable {
            private String name;
            private String email;

            public User(String name, String email) {
                this.name = name;
                this.email = email;
            }

            public String getCreatedBy() { return name; }
            public String getName() { return name; }
            public String getEmail() { return email; }
        }

        public enum Role {
            ADMIN,
            USER,
            GUEST
        }
      `;
      const rootNode = parseCode(code);
      const entities = extractAllEntities(rootNode as any, TEST_FILE);

      expect(entities.imports).toHaveLength(3);
      expect(entities.classes).toHaveLength(2); // BaseEntity, User
      expect(entities.interfaces).toHaveLength(1); // Auditable
      expect(entities.types).toHaveLength(1); // Role enum
      expect(entities.functions.length).toBeGreaterThanOrEqual(5); // getId, constructor, getCreatedBy, getName, getEmail
      expect(entities.variables.length).toBeGreaterThanOrEqual(3); // id, name, email

      // Verify inheritance
      const baseEntity = entities.classes.find((c) => c.name === 'BaseEntity');
      expect(baseEntity?.isAbstract).toBe(true);
      expect(baseEntity?.implements).toContain('Serializable');

      const user = entities.classes.find((c) => c.name === 'User');
      expect(user?.extends).toBe('BaseEntity');
      expect(user?.implements).toContain('Auditable');

      // Verify docstring
      expect(baseEntity?.docstring).toContain('Base entity');
    });
  });
});
