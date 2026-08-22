/**
 * Rust Plugin Unit Tests
 * Tests for entity extraction from Rust syntax trees
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Parser from 'tree-sitter';
import Rust from 'tree-sitter-rust';
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
  extractStructsWithEdges,
} from '../src';
import type { HasParamEdgeDescriptor, ReturnsEdgeDescriptor, UsesTypeEdgeDescriptor } from '@codegraph/types';
import type { TypeRefEntity } from '@codegraph/types';

const TEST_FILE = '/test/main.rs';

let parser: Parser;

function parseCode(code: string): Parser.SyntaxNode {
  const tree = parser.parse(code);
  return tree.rootNode;
}

describe('Rust Extractors', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(Rust as any);
  });

  afterAll(() => {
    // Parser cleanup if needed
  });

  // ==========================================================================
  // Struct Extraction (ClassEntity)
  // ==========================================================================

  describe('extractClasses (structs)', () => {
    it('should extract pub struct declarations', () => {
      const code = `
        pub struct Server {
            host: String,
            port: u16,
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('Server');
      expect(classes[0].isExported).toBe(true);
      expect(classes[0].isAbstract).toBe(false);
    });

    it('should extract private structs', () => {
      const code = `
        struct Config {
            debug: bool,
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('Config');
      expect(classes[0].isExported).toBe(false);
    });

    it('should extract doc comments from structs', () => {
      const code = `
        /// A server that handles HTTP requests.
        /// It manages connections and routing.
        pub struct Server {
            port: u16,
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].docstring).toBeDefined();
      expect(classes[0].docstring).toContain('server that handles HTTP requests');
    });

    it('should extract multiple structs', () => {
      const code = `
        pub struct Request {
            method: String,
        }
        pub struct Response {
            status: u16,
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(2);
      expect(classes.some((c) => c.name === 'Request')).toBe(true);
      expect(classes.some((c) => c.name === 'Response')).toBe(true);
    });

    it('should not extract traits as classes', () => {
      const code = `
        pub trait Handler {
            fn handle(&self);
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Trait Extraction (InterfaceEntity)
  // ==========================================================================

  describe('extractInterfaces (traits)', () => {
    it('should extract trait declarations', () => {
      const code = `
        pub trait Handler {
            fn handle(&self) -> Response;
        }
      `;
      const rootNode = parseCode(code);
      const interfaces = extractInterfaces(rootNode as any, TEST_FILE);

      expect(interfaces).toHaveLength(1);
      expect(interfaces[0].name).toBe('Handler');
      expect(interfaces[0].isExported).toBe(true);
    });

    it('should extract trait with supertraits', () => {
      const code = `
        pub trait Logger: Handler + Send {
            fn log(&self, msg: &str);
        }
      `;
      const rootNode = parseCode(code);
      const interfaces = extractInterfaces(rootNode as any, TEST_FILE);

      expect(interfaces).toHaveLength(1);
      expect(interfaces[0].name).toBe('Logger');
      expect(interfaces[0].extends).toBeDefined();
      expect(interfaces[0].extends).toContain('Handler');
      expect(interfaces[0].extends).toContain('Send');
    });

    it('should extract private traits', () => {
      const code = `
        trait Internal {
            fn process(&self);
        }
      `;
      const rootNode = parseCode(code);
      const interfaces = extractInterfaces(rootNode as any, TEST_FILE);

      expect(interfaces).toHaveLength(1);
      expect(interfaces[0].name).toBe('Internal');
      expect(interfaces[0].isExported).toBe(false);
    });

    it('should extract doc comments from traits', () => {
      const code = `
        /// A handler for processing requests.
        pub trait Handler {
            fn handle(&self);
        }
      `;
      const rootNode = parseCode(code);
      const interfaces = extractInterfaces(rootNode as any, TEST_FILE);

      expect(interfaces).toHaveLength(1);
      expect(interfaces[0].docstring).toContain('handler for processing requests');
    });
  });

  // ==========================================================================
  // Function & Method Extraction
  // ==========================================================================

  describe('extractFunctions', () => {
    it('should extract top-level functions', () => {
      const code = `
        pub fn process(data: &[u8]) -> String {
            String::new()
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('process');
      expect(functions[0].isExported).toBe(true);
      expect(functions[0].isAsync).toBe(false);
    });

    it('should extract private functions', () => {
      const code = `
        fn helper() -> i32 {
            42
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('helper');
      expect(functions[0].isExported).toBe(false);
    });

    it('should extract function parameters', () => {
      const code = `
        fn add(a: i32, b: i32) -> i32 {
            a + b
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].params).toHaveLength(2);
      expect(functions[0].params[0].name).toBe('a');
      expect(functions[0].params[0].type).toBe('i32');
    });

    it('should extract return type', () => {
      const code = `
        fn compute() -> Result<String, Error> {
            Ok(String::new())
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].returnType).toBeDefined();
      expect(functions[0].returnType).toContain('Result');
    });

    it('should extract methods from impl blocks', () => {
      const code = `
        struct Server {
            port: u16,
        }

        impl Server {
            pub fn new(port: u16) -> Self {
                Server { port }
            }

            fn start(&self) {
            }
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(2);
      const newFn = functions.find((f) => f.name === 'new');
      expect(newFn).toBeDefined();
      expect(newFn?.isExported).toBe(true);

      const startFn = functions.find((f) => f.name === 'start');
      expect(startFn).toBeDefined();
      expect(startFn?.isExported).toBe(false);
    });

    it('should extract self parameter', () => {
      const code = `
        struct Foo {}
        impl Foo {
            fn bar(&self, x: i32) {
            }
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      const bar = functions.find((f) => f.name === 'bar');
      expect(bar).toBeDefined();
      expect(bar?.params.some((p) => p.name === 'self')).toBe(true);
      expect(bar?.params.some((p) => p.name === 'x')).toBe(true);
    });

    it('should extract async functions', () => {
      const code = `
        async fn fetch_data(url: &str) -> Result<String, Error> {
            todo!()
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('fetch_data');
      expect(functions[0].isAsync).toBe(true);
    });

    it('should extract doc comments from functions', () => {
      const code = `
        /// Processes the input data.
        /// Returns the result string.
        pub fn process(data: &[u8]) -> String {
            String::new()
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].docstring).toContain('Processes the input data');
    });
  });

  // ==========================================================================
  // Variable Extraction (const, static)
  // ==========================================================================

  describe('extractVariables', () => {
    it('should extract const declarations', () => {
      const code = `
        pub const MAX_SIZE: usize = 1024;
      `;
      const rootNode = parseCode(code);
      const variables = extractVariables(rootNode as any, TEST_FILE);

      expect(variables).toHaveLength(1);
      expect(variables[0].name).toBe('MAX_SIZE');
      expect(variables[0].kind).toBe('const');
      expect(variables[0].isExported).toBe(true);
      expect(variables[0].type).toBe('usize');
    });

    it('should extract static declarations', () => {
      const code = `
        pub static GLOBAL: &str = "default";
      `;
      const rootNode = parseCode(code);
      const variables = extractVariables(rootNode as any, TEST_FILE);

      expect(variables).toHaveLength(1);
      expect(variables[0].name).toBe('GLOBAL');
      expect(variables[0].kind).toBe('let'); // static maps to 'let'
      expect(variables[0].isExported).toBe(true);
    });

    it('should extract private constants', () => {
      const code = `
        const DEFAULT_PORT: u16 = 8080;
      `;
      const rootNode = parseCode(code);
      const variables = extractVariables(rootNode as any, TEST_FILE);

      expect(variables).toHaveLength(1);
      expect(variables[0].name).toBe('DEFAULT_PORT');
      expect(variables[0].isExported).toBe(false);
    });

    it('should extract both const and static', () => {
      const code = `
        pub const MAX: usize = 100;
        pub static COUNTER: i32 = 0;
      `;
      const rootNode = parseCode(code);
      const variables = extractVariables(rootNode as any, TEST_FILE);

      expect(variables).toHaveLength(2);
      expect(variables.some((v) => v.name === 'MAX' && v.kind === 'const')).toBe(true);
      expect(variables.some((v) => v.name === 'COUNTER' && v.kind === 'let')).toBe(true);
    });
  });

  // ==========================================================================
  // Import Extraction (use declarations)
  // ==========================================================================

  describe('extractImports', () => {
    it('should extract simple use declarations', () => {
      const code = `
        use std::collections::HashMap;
      `;
      const rootNode = parseCode(code);
      const imports = extractImports(rootNode as any, TEST_FILE);

      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('std::collections::HashMap');
      expect(imports[0].specifiers).toHaveLength(1);
      expect(imports[0].specifiers[0].name).toBe('HashMap');
    });

    it('should extract grouped use declarations', () => {
      const code = `
        use std::io::{Read, Write};
      `;
      const rootNode = parseCode(code);
      const imports = extractImports(rootNode as any, TEST_FILE);

      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('std::io');
      expect(imports[0].specifiers).toHaveLength(2);
      expect(imports[0].specifiers.some((s) => s.name === 'Read')).toBe(true);
      expect(imports[0].specifiers.some((s) => s.name === 'Write')).toBe(true);
    });

    it('should extract external crate imports', () => {
      const code = `
        use serde::Serialize;
      `;
      const rootNode = parseCode(code);
      const imports = extractImports(rootNode as any, TEST_FILE);

      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('serde::Serialize');
      expect(imports[0].specifiers[0].name).toBe('Serialize');
    });

    it('should extract multiple use declarations', () => {
      const code = `
        use std::fmt;
        use std::io;
        use std::collections::HashMap;
      `;
      const rootNode = parseCode(code);
      const imports = extractImports(rootNode as any, TEST_FILE);

      expect(imports).toHaveLength(3);
    });

    it('should handle wildcard imports', () => {
      const code = `
        use std::io::*;
      `;
      const rootNode = parseCode(code);
      const imports = extractImports(rootNode as any, TEST_FILE);

      expect(imports).toHaveLength(1);
      expect(imports[0].isNamespace).toBe(true);
    });
  });

  // ==========================================================================
  // Type Extraction (type aliases, enums)
  // ==========================================================================

  describe('extractTypes', () => {
    it('should extract type aliases', () => {
      const code = `
        pub type Callback = fn(i32) -> bool;
      `;
      const rootNode = parseCode(code);
      const types = extractTypes(rootNode as any, TEST_FILE);

      expect(types).toHaveLength(1);
      expect(types[0].name).toBe('Callback');
      expect(types[0].kind).toBe('type');
      expect(types[0].isExported).toBe(true);
    });

    it('should extract enums', () => {
      const code = `
        pub enum Color {
            Red,
            Green,
            Blue,
        }
      `;
      const rootNode = parseCode(code);
      const types = extractTypes(rootNode as any, TEST_FILE);

      expect(types).toHaveLength(1);
      expect(types[0].name).toBe('Color');
      expect(types[0].kind).toBe('enum');
      expect(types[0].isExported).toBe(true);
    });

    it('should extract private enums', () => {
      const code = `
        enum State {
            Active,
            Inactive,
        }
      `;
      const rootNode = parseCode(code);
      const types = extractTypes(rootNode as any, TEST_FILE);

      expect(types).toHaveLength(1);
      expect(types[0].name).toBe('State');
      expect(types[0].isExported).toBe(false);
    });

    it('should not extract structs or traits as types', () => {
      const code = `
        pub struct Server { port: u16 }
        pub trait Handler { fn handle(&self); }
        pub type Callback = fn() -> bool;
      `;
      const rootNode = parseCode(code);
      const types = extractTypes(rootNode as any, TEST_FILE);

      // Only Callback should be extracted as type
      expect(types).toHaveLength(1);
      expect(types[0].name).toBe('Callback');
    });
  });

  // ==========================================================================
  // Inheritance Extraction
  // ==========================================================================

  describe('extractInheritance', () => {
    it('should extract impl Trait for Struct as implements', () => {
      const code = `
        pub trait Handler {
            fn handle(&self);
        }
        pub struct Server {}
        impl Handler for Server {
            fn handle(&self) {}
        }
      `;
      const rootNode = parseCode(code);
      const inheritance = extractInheritance(rootNode as any, TEST_FILE);

      const implRefs = inheritance.filter((r) => r.type === 'implements');
      expect(implRefs).toHaveLength(1);
      expect(implRefs[0].childName).toBe('Server');
      expect(implRefs[0].parentName).toBe('Handler');
    });

    it('should extract trait supertraits as extends', () => {
      const code = `
        pub trait Handler {
            fn handle(&self);
        }
        pub trait Logger: Handler + Send {
            fn log(&self);
        }
      `;
      const rootNode = parseCode(code);
      const inheritance = extractInheritance(rootNode as any, TEST_FILE);

      const extendsRefs = inheritance.filter((r) => r.type === 'extends');
      expect(extendsRefs.some((r) => r.childName === 'Logger' && r.parentName === 'Handler')).toBe(true);
      expect(extendsRefs.some((r) => r.childName === 'Logger' && r.parentName === 'Send')).toBe(true);
    });

    it('should not create inheritance for inherent impl blocks', () => {
      const code = `
        pub struct Server {}
        impl Server {
            pub fn new() -> Self { Server {} }
        }
      `;
      const rootNode = parseCode(code);
      const inheritance = extractInheritance(rootNode as any, TEST_FILE);

      // Inherent impl (no trait) should not create inheritance edges
      expect(inheritance).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Call Extraction
  // ==========================================================================

  describe('extractCalls', () => {
    it('should extract local function calls', () => {
      const code = `
        fn validate() -> bool { true }
        fn transform() {}
        fn process() {
            validate();
            transform();
        }
      `;
      const rootNode = parseCode(code);
      const calls = extractCalls(rootNode as any, TEST_FILE);

      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(calls.some((c) => c.callerName === 'process' && c.calleeName === 'validate')).toBe(true);
      expect(calls.some((c) => c.callerName === 'process' && c.calleeName === 'transform')).toBe(true);
    });

    it('should skip built-in function calls', () => {
      const code = `
        fn process() {
            let x = String::new();
            let y = x.clone();
            drop(x);
        }
      `;
      const rootNode = parseCode(code);
      const calls = extractCalls(rootNode as any, TEST_FILE);

      // clone, drop, new are builtins — should be skipped
      expect(calls.filter((c) => c.callerName === 'process')).toHaveLength(0);
    });

    it('should not extract calls to external functions', () => {
      const code = `
        use std::fs;
        fn process() {
            fs::read_to_string("file.txt");
        }
      `;
      const rootNode = parseCode(code);
      const calls = extractCalls(rootNode as any, TEST_FILE);

      // fs::read_to_string is external
      expect(calls.filter((c) => c.callerName === 'process')).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Extract All Entities
  // ==========================================================================

  describe('extractAllEntities', () => {
    it('should extract all entity types at once', () => {
      const code = `
        use std::fmt;

        pub trait Handler {
            fn handle(&self);
        }

        pub type Callback = fn() -> bool;

        pub struct Server {
            port: u16,
        }

        pub const MAX_SIZE: usize = 1024;

        pub fn new_server(port: u16) -> Server {
            Server { port }
        }

        impl Server {
            pub fn start(&self) {}
        }
      `;
      const rootNode = parseCode(code);
      const entities = extractAllEntities(rootNode as any, TEST_FILE);

      expect(entities.imports).toHaveLength(1);
      expect(entities.interfaces).toHaveLength(1); // Handler trait
      expect(entities.classes).toHaveLength(1); // Server struct
      expect(entities.types).toHaveLength(1); // Callback
      expect(entities.variables.length).toBeGreaterThan(0); // MAX_SIZE
      expect(entities.functions.length).toBeGreaterThanOrEqual(2); // new_server + start
      expect(entities.components).toHaveLength(0);
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
    });

    it('should handle complex Rust file', () => {
      const code = `
        use std::collections::HashMap;
        use std::io::{Read, Write};
        use serde::Serialize;

        /// A handler for processing requests.
        pub trait Handler {
            fn handle(&self, data: &[u8]) -> Vec<u8>;
        }

        /// Middleware wraps a handler.
        pub type Middleware = fn(&dyn Handler) -> Box<dyn Handler>;

        pub enum LogLevel {
            Debug,
            Info,
            Error,
        }

        /// Router manages HTTP routes.
        pub struct Router {
            routes: HashMap<String, Box<dyn Handler>>,
        }

        pub const MAX_ROUTES: usize = 1000;
        static DEFAULT_PORT: u16 = 8080;

        /// Creates a new Router.
        pub fn new_router() -> Router {
            Router { routes: HashMap::new() }
        }

        impl Router {
            pub fn add_route(&mut self, path: String, handler: Box<dyn Handler>) {
                self.routes.insert(path, handler);
            }

            fn route_count(&self) -> usize {
                self.routes.len()
            }
        }

        impl Handler for Router {
            fn handle(&self, data: &[u8]) -> Vec<u8> {
                vec![]
            }
        }
      `;
      const rootNode = parseCode(code);
      const entities = extractAllEntities(rootNode as any, TEST_FILE);

      expect(entities.imports).toHaveLength(3);
      expect(entities.interfaces).toHaveLength(1); // Handler
      expect(entities.classes).toHaveLength(1); // Router
      expect(entities.types).toHaveLength(2); // Middleware + LogLevel
      expect(entities.variables.length).toBeGreaterThanOrEqual(2); // MAX_ROUTES + DEFAULT_PORT
      expect(entities.functions.length).toBeGreaterThanOrEqual(4); // new_router, add_route, route_count, handle

      // Verify specifics
      const router = entities.classes.find((c) => c.name === 'Router');
      expect(router?.isExported).toBe(true);
      expect(router?.docstring).toContain('Router manages HTTP routes');

      const handler = entities.interfaces.find((i) => i.name === 'Handler');
      expect(handler?.isExported).toBe(true);

      const newRouter = entities.functions.find((f) => f.name === 'new_router');
      expect(newRouter?.isExported).toBe(true);
      expect(newRouter?.docstring).toContain('Creates a new Router');
    });
  });

  // ==========================================================================
  // runRustExtraction helper (used by HAS_PARAM / RETURNS / USES_TYPE tests)
  // ==========================================================================

  function runRustExtraction(code: string, fileName: string) {
    const rootNode = parseCode(code);
    return extractAllEntities(rootNode as any, `/test/${fileName}`);
  }

  // ==========================================================================
  // HAS_METHOD / HAS_PROPERTY Edges
  // ==========================================================================

  describe('Rust: HAS_METHOD / HAS_PROPERTY', () => {
    it('emits HAS_METHOD from impl block to struct', () => {
      const code = `
pub struct User {
    pub name: String,
    age: u32,
}

impl User {
    pub fn new(name: String) -> Self {
        User { name, age: 0 }
    }

    pub fn greet(&self) -> String {
        format!("hi {}", self.name)
    }
}
`;
      const rootNode = parseCode(code);
      const result = extractAllEntities(rootNode as any, TEST_FILE);

      const userStruct = result.classes.find((e) => e.name === 'User');
      expect(userStruct).toBeDefined();

      const methodEdges = (result.hasMethodEdges ?? []).filter(
        (e) => e.fromId === userStruct!.id,
      );
      expect(methodEdges).toHaveLength(2);

      const newEdge = methodEdges.find((e) => {
        const target = result.functions.find((f) => f.id === e.toId);
        return target?.name === 'new';
      });
      expect(newEdge).toBeDefined();
      expect(newEdge!.isStatic).toBe(true); // no self → static

      const greetEdge = methodEdges.find((e) => {
        const target = result.functions.find((f) => f.id === e.toId);
        return target?.name === 'greet';
      });
      expect(greetEdge).toBeDefined();
      expect(greetEdge!.isStatic).toBe(false); // has &self
    });

    it('emits HAS_PROPERTY edges for struct fields with correct visibility', () => {
      const code = `
pub struct User {
    pub name: String,
    age: u32,
}
`;
      const rootNode = parseCode(code);
      const result = extractAllEntities(rootNode as any, TEST_FILE);

      const userStruct = result.classes.find((e) => e.name === 'User');
      expect(userStruct).toBeDefined();

      const fieldEdges = (result.hasPropertyEdges ?? []).filter(
        (e) => e.fromId === userStruct!.id,
      );
      expect(fieldEdges).toHaveLength(2);

      const propertyIds = new Set(fieldEdges.map((edge) => edge.toId));
      const nameField = result.variables.find(
        (variable) => variable.name === 'name' && propertyIds.has(variable.id),
      );
      const ageField = result.variables.find(
        (variable) => variable.name === 'age' && propertyIds.has(variable.id),
      );
      expect(nameField).toBeDefined();
      expect(ageField).toBeDefined();
      expect(nameField!.scopeKey).toBe('Class:User');

      const nameEdge = fieldEdges.find((e) => e.toId === nameField!.id);
      const ageEdge = fieldEdges.find((e) => e.toId === ageField!.id);
      expect(nameEdge?.visibility).toBe('public');
      expect(ageEdge?.visibility).toBe('private');
      expect(nameEdge?.isReadonly).toBe(false);
      expect(ageEdge?.isStatic).toBe(false);
    });

    it('handles impl Trait for Struct', () => {
      const code = `
pub trait Greeter {
    fn greet(&self) -> String;
}

pub struct Bot;

impl Greeter for Bot {
    fn greet(&self) -> String { "hi".to_string() }
}
`;
      const rootNode = parseCode(code);
      const result = extractAllEntities(rootNode as any, TEST_FILE);

      const botStruct = result.classes.find((e) => e.name === 'Bot');
      expect(botStruct).toBeDefined();

      const methodEdges = (result.hasMethodEdges ?? []).filter(
        (e) => e.fromId === botStruct!.id,
      );
      expect(methodEdges.length).toBeGreaterThanOrEqual(1);
      expect(methodEdges[0]!.toId).toBeTruthy();

      // greet has &self → isStatic = false
      expect(methodEdges[0]!.isStatic).toBe(false);
    });

    it('skips impl on external type without crashing', () => {
      const code = `
impl SomeExternalType {
    pub fn local_method(&self) {}
}
`;
      const rootNode = parseCode(code);
      const result = extractAllEntities(rootNode as any, TEST_FILE);

      // No struct named SomeExternalType in this file → no HAS_METHOD edges
      const externalEdges = (result.hasMethodEdges ?? []).filter((e) => {
        const target = result.functions.find((f) => f.id === e.toId);
        return target?.name === 'local_method';
      });
      expect(externalEdges).toHaveLength(0);
    });

    it('extractStructsWithEdges returns correct shape for struct with both fields and methods', () => {
      const code = `
pub struct Counter {
    pub count: u64,
    step: u64,
}

impl Counter {
    pub fn new(step: u64) -> Self {
        Counter { count: 0, step }
    }

    pub fn increment(&mut self) {
        self.count += self.step;
    }

    fn reset(&mut self) {
        self.count = 0;
    }
}
`;
      const rootNode = parseCode(code);
      const result = extractStructsWithEdges(rootNode as any, TEST_FILE);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0]!.name).toBe('Counter');

      expect(result.hasMethodEdges).toHaveLength(3); // new, increment, reset
      expect(result.hasPropertyEdges).toHaveLength(2); // count, step

      // new → static (no self)
      const newEdge = result.hasMethodEdges.find((e) => {
        const fn_ = result.methodEntities.find((f) => f.id === e.toId);
        return fn_?.name === 'new';
      });
      expect(newEdge?.isStatic).toBe(true);

      // increment → instance (&mut self)
      const incrEdge = result.hasMethodEdges.find((e) => {
        const fn_ = result.methodEntities.find((f) => f.id === e.toId);
        return fn_?.name === 'increment';
      });
      expect(incrEdge?.isStatic).toBe(false);

      // reset → private visibility
      const resetEdge = result.hasMethodEdges.find((e) => {
        const fn_ = result.methodEntities.find((f) => f.id === e.toId);
        return fn_?.name === 'reset';
      });
      expect(resetEdge?.visibility).toBe('private');

      // count → public property
      const countProp = result.propertyEntities.find((v) => v.name === 'count');
      expect(countProp).toBeDefined();
      const countEdge = result.hasPropertyEdges.find((e) => e.toId === countProp!.id);
      expect(countEdge?.visibility).toBe('public');

      // step → private property
      const stepProp = result.propertyEntities.find((v) => v.name === 'step');
      expect(stepProp).toBeDefined();
      const stepEdge = result.hasPropertyEdges.find((e) => e.toId === stepProp!.id);
      expect(stepEdge?.visibility).toBe('private');
    });
  });

  // ==========================================================================
  // HAS_PARAM / RETURNS / USES_TYPE Edges
  // ==========================================================================

  describe('Rust: HAS_PARAM / RETURNS / USES_TYPE', () => {
    it('emits HAS_PARAM and RETURNS for typed function', () => {
      const code = `
pub fn greet(name: &str, count: u32) -> String {
    let msg: String = format!("hi");
    msg.repeat(count as usize)
}
`;
      const result = runRustExtraction(code, 'greet.rs');
      const fn_ = result.entities
        ? (result as any).entities.find((e: any) => e.name === 'greet' && e.type === 'Function')
        : result.functions.find((f) => f.name === 'greet');
      expect(fn_).toBeDefined();

      const hasParam = ((result.hasParamEdges ?? []) as HasParamEdgeDescriptor[]).filter(
        (e) => e.fromId === fn_!.id,
      );
      expect(hasParam).toHaveLength(2);

      const returns = ((result.returnsEdges ?? []) as ReturnsEdgeDescriptor[]).filter(
        (e) => e.fromId === fn_!.id,
      );
      expect(returns).toHaveLength(1);
      const ret = returns[0]!;
      const returnRef = ((result.typeRefs ?? []) as TypeRefEntity[]).find(
        (t) => t.id === ret.toId,
      )!;
      expect(returnRef.name).toBe('String');

      const uses = ((result.usesTypeEdges ?? []) as UsesTypeEdgeDescriptor[]).filter(
        (e) => e.fromId === fn_!.id,
      );
      expect(uses.some((e) => e.kind === 'annotation')).toBe(true);
      expect(uses.some((e) => e.kind === 'cast')).toBe(true);
    });

    it('skips self parameter from HAS_PARAM', () => {
      const code = `
struct User;

impl User {
    pub fn greet(&self, prefix: &str) -> String {
        prefix.to_string()
    }
}
`;
      const result = runRustExtraction(code, 'user.rs');
      // greet is a method → its HAS_PARAM edges use generateEntityId format (same as any function).
      // After deduplication, exactly one entity named 'greet' exists in the functions array.
      const allHasParam = (result.hasParamEdges ?? []) as HasParamEdgeDescriptor[];
      const greetFnIds = result.functions
        .filter((f) => f.name === 'greet')
        .map((f) => f.id);
      const hasParam = allHasParam.filter((e) => greetFnIds.includes(e.fromId));
      // Just `prefix`, not `self`
      expect(hasParam).toHaveLength(1);
      expect(hasParam[0]!.name).toBe('prefix');
    });

    it('emits RETURNS to () unit when no return type', () => {
      const code = `
fn run() {
    let x = 1;
}
`;
      const result = runRustExtraction(code, 'run.rs');
      const fn_ = result.functions.find((f) => f.name === 'run');
      expect(fn_).toBeDefined();

      const returns = ((result.returnsEdges ?? []) as ReturnsEdgeDescriptor[]).filter(
        (e) => e.fromId === fn_!.id,
      );
      expect(returns).toHaveLength(1);
      expect(returns[0]!.toId).toBe('prim::rust::()');
    });

    it('marks isAsync correctly for async functions', () => {
      const code = `
async fn fetch_data(url: &str) -> String {
    String::new()
}
`;
      const result = runRustExtraction(code, 'fetch.rs');
      const fn_ = result.functions.find((f) => f.name === 'fetch_data');
      expect(fn_).toBeDefined();

      const returns = ((result.returnsEdges ?? []) as ReturnsEdgeDescriptor[]).filter(
        (e) => e.fromId === fn_!.id,
      );
      expect(returns).toHaveLength(1);
      expect(returns[0]!.isAsync).toBe(true);
    });

    it('preserves & vs base type as distinct Type ids', () => {
      const code = `
fn f(s: &str) -> String { s.to_string() }
`;
      const result = runRustExtraction(code, 'f.rs');
      const fn_ = result.functions.find((f) => f.name === 'f');
      expect(fn_).toBeDefined();

      const hasParam = ((result.hasParamEdges ?? []) as HasParamEdgeDescriptor[]).filter(
        (e) => e.fromId === fn_!.id,
      );
      expect(hasParam).toHaveLength(1);
      const paramTypeRef = ((result.typeRefs ?? []) as TypeRefEntity[]).find(
        (t) => t.id === hasParam[0]!.toId,
      )!;
      expect(paramTypeRef.name).toBe('&str');
      // Different from the bare 'str' primitive
      expect(paramTypeRef.id).not.toBe('prim::rust::str');
    });

    it('emits instantiation USES_TYPE for generic types in body', () => {
      const code = `
fn make_vec() -> Vec<u32> {
    let v: Vec<u32> = Vec::new();
    v
}
`;
      const result = runRustExtraction(code, 'vec.rs');
      const fn_ = result.functions.find((f) => f.name === 'make_vec');
      expect(fn_).toBeDefined();

      const uses = ((result.usesTypeEdges ?? []) as UsesTypeEdgeDescriptor[]).filter(
        (e) => e.fromId === fn_!.id,
      );
      // annotation for let v: Vec<u32> AND instantiation for the generic_type
      const instantiation = uses.find((e) => e.kind === 'instantiation');
      expect(instantiation).toBeDefined();
      const typeRef = ((result.typeRefs ?? []) as TypeRefEntity[]).find(
        (t) => t.id === instantiation!.toId,
      )!;
      expect(typeRef.name).toBe('Vec<u32>');
    });

    it('deduplicates USES_TYPE edges within a function', () => {
      const code = `
fn multi_cast(a: u32, b: u32) {
    let _x = a as usize;
    let _y = b as usize;
}
`;
      const result = runRustExtraction(code, 'dedup.rs');
      const fn_ = result.functions.find((f) => f.name === 'multi_cast');
      expect(fn_).toBeDefined();

      const uses = ((result.usesTypeEdges ?? []) as UsesTypeEdgeDescriptor[]).filter(
        (e) => e.fromId === fn_!.id && e.kind === 'cast',
      );
      // Two casts to usize — should be deduplicated to 1
      expect(uses).toHaveLength(1);
    });
  });
});
